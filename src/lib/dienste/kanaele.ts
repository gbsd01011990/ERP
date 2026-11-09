/**
 * Messenger je Firma: Zugänge verwalten, eingehende Nachrichten als Gespräch ablegen,
 * aus dem ERP antworten. Ein Chat = ein Gespräch; eine neue Nachricht öffnet es wieder.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Kanal } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { verschluesseln, entschluesseln } from "../geheim";
import { kontaktName } from "../format";
import { istOffen, type Wochenplan } from "../agent/zeiten";
import {
  telegramSenden, telegramWebhookSetzen, whatsappSenden, whatsappFensterOffen, smsSenden,
  type Eingang, type Geheim, type KanalName,
} from "../kanaele/adapter";
import { FachFehler } from "./fehler";
import { rollePruefen } from "./zugriff";
import { agentFuerFirma, kontakteZurNummer } from "./telefonagent";

export const KANAL_TEXT: Record<Kanal, string> = { TELEFON: "Telefon", WHATSAPP: "WhatsApp", TELEGRAM: "Telegram", SMS: "SMS", THREEMA: "Threema" };
export const MESSENGER: KanalName[] = ["WHATSAPP", "TELEGRAM", "SMS"];

const STANDARD_ABWESENHEIT = "Danke für Ihre Nachricht. Unser Büro ist gerade nicht besetzt, wir melden uns am nächsten Werktag.";

export const geheimLesen = (z: { geheim: string | null }): Geheim => (z.geheim ? JSON.parse(entschluesseln(z.geheim)) : {});

export async function zugangLaden(kuerzel: string, kanal: KanalName) {
  const f = await db.firma.findUnique({ where: { kuerzel: kuerzel.toUpperCase() } });
  if (!f) return null;
  return db.kanalZugang.findUnique({ where: { firmaId_kanal: { firmaId: f.id, kanal } } });
}

export async function zugaengeDerFirma(firmaId: string) {
  const vorhanden = await db.kanalZugang.findMany({ where: { firmaId } });
  return MESSENGER.map((k) => vorhanden.find((v) => v.kanal === k) ?? null);
}

// ------------------------------------------------------------------ Einstellungen

export const ZugangEingabe = z.object({
  kanal: z.enum(["WHATSAPP", "TELEGRAM", "SMS"]),
  aktiv: z.boolean(),
  kennung: z.string().nullish(),
  abwesenheit: z.string().nullish(),
  /** Nur ausgefüllte Felder überschreiben die gespeicherten Geheimnisse. */
  geheim: z.record(z.string()).default({}),
});

const PFLICHT: Record<KanalName, { kennung: string; felder: string[] }> = {
  TELEGRAM: { kennung: "Bot-Name", felder: ["token"] },
  WHATSAPP: { kennung: "Phone-Number-ID", felder: ["zugriffstoken", "appGeheimnis", "verifyToken"] },
  SMS: { kennung: "Absendernummer (+49…)", felder: ["accountSid", "authToken"] },
};

export async function zugangSpeichern(b: AktuellerBenutzer, eingabe: z.input<typeof ZugangEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  const e = ZugangEingabe.parse(eingabe);
  const alt = await db.kanalZugang.findUnique({ where: { firmaId_kanal: { firmaId: b.mandant.id, kanal: e.kanal } } });
  const g = alt ? geheimLesen(alt) : {};
  const schluessel = e.kanal === "TELEGRAM" ? "telegram" : e.kanal === "WHATSAPP" ? "whatsapp" : "sms";
  const bisher = (g[schluessel] ?? {}) as Record<string, string>;
  const neu: Record<string, string> = { ...bisher };
  for (const [k, v] of Object.entries(e.geheim)) if (v.trim()) neu[k] = v.trim();
  if (e.kanal === "TELEGRAM" && !neu.webhookGeheimnis) neu.webhookGeheimnis = randomBytes(24).toString("hex");
  if (e.aktiv) {
    const p = PFLICHT[e.kanal];
    if (!e.kennung?.trim()) throw new FachFehler(`${p.kennung} fehlt.`);
    const fehlt = p.felder.filter((f) => !neu[f]);
    if (fehlt.length) throw new FachFehler(`Zum Einschalten fehlen: ${fehlt.join(", ")}.`);
  }
  const daten = {
    aktiv: e.aktiv, kennung: e.kennung?.trim() || null, abwesenheit: e.abwesenheit?.trim() || null,
    geheim: verschluesseln(JSON.stringify({ ...g, [schluessel]: neu })),
  };
  await db.kanalZugang.upsert({ where: { firmaId_kanal: { firmaId: b.mandant.id, kanal: e.kanal } }, update: daten, create: { firmaId: b.mandant.id, kanal: e.kanal, ...daten } });
}

/** Telegram muss die Webhook-Adresse kennen; das erledigt ein Aufruf von setWebhook. */
export async function telegramVerbinden(b: AktuellerBenutzer, basisUrl: string) {
  rollePruefen(b, ["ADMIN"]);
  const z = await db.kanalZugang.findUnique({ where: { firmaId_kanal: { firmaId: b.mandant.id, kanal: "TELEGRAM" } } });
  const g = z ? geheimLesen(z).telegram : undefined;
  if (!g?.token) throw new FachFehler("Bitte zuerst den Bot-Token speichern.");
  await telegramWebhookSetzen(g, `${basisUrl}/api/kanal/${b.mandant.kuerzel.toLowerCase()}/telegram`);
}

// ------------------------------------------------------------------ Eingang

/**
 * Eingehende Nachrichten ablegen. Doppelt zugestellte Nachrichten (gleiche ID) werden übergangen.
 * Außerhalb der Bürozeiten antwortet das ERP einmal je 12 Stunden mit dem Abwesenheitstext.
 */
export async function eingangVerarbeiten(zugang: { id: string; firmaId: string; kanal: Kanal; kennung: string | null; abwesenheit: string | null; geheim: string | null }, eingaenge: Eingang[], jetzt = new Date()) {
  const agent = await agentFuerFirma(zugang.firmaId);
  const ergebnisse: { gespraechId: string; neu: boolean }[] = [];
  for (const e of eingaenge) {
    let g = await db.gespraech.findUnique({ where: { firmaId_kanal_externId: { firmaId: zugang.firmaId, kanal: zugang.kanal, externId: e.chat } } });
    if (g && (await db.gespraechNachricht.findFirst({ where: { gespraechId: g.id, externId: e.nachrichtId } }))) continue;
    const kontakt = !g?.kontaktId && e.telefon ? (await kontakteZurNummer(e.telefon))[0] ?? null : null;
    const warOffen = g?.status === "OFFEN";
    if (!g) {
      g = await db.gespraech.create({
        data: {
          firmaId: zugang.firmaId, kanal: zugang.kanal, externId: e.chat, absender: e.absender,
          absenderName: kontakt ? kontaktName(kontakt) : e.name, kontaktId: kontakt?.id ?? null,
          zustaendigId: agent.standardZustaendigId, beginn: e.zeit, anliegen: e.text.slice(0, 200),
        },
      });
    } else {
      g = await db.gespraech.update({
        where: { id: g.id },
        data: { status: "OFFEN", ...(kontakt ? { kontaktId: kontakt.id, absenderName: kontaktName(kontakt) } : {}), ...(warOffen ? {} : { anliegen: e.text.slice(0, 200), beginn: e.zeit }) },
      });
    }
    await db.gespraechNachricht.create({ data: { gespraechId: g.id, von: "KUNDE", text: e.text, zeit: e.zeit, externId: e.nachrichtId } });
    if (!warOffen && g.kontaktId) {
      await db.logbuchEintrag.create({ data: { kontaktId: g.kontaktId, firmaId: zugang.firmaId, art: "NOTIZ", text: `${KANAL_TEXT[zugang.kanal]}-Nachricht: ${e.text.slice(0, 300)}` } });
    }
    ergebnisse.push({ gespraechId: g.id, neu: !warOffen });

    // Abwesenheitsnotiz
    if (!istOffen(agent.buerozeiten as Wochenplan, jetzt)) {
      const kuerzlich = await db.gespraechNachricht.findFirst({ where: { gespraechId: g.id, von: "AGENT", zeit: { gte: new Date(jetzt.getTime() - 12 * 3600e3) } } });
      if (!kuerzlich) {
        const text = zugang.abwesenheit ?? STANDARD_ABWESENHEIT;
        try {
          const id = await senden(zugang, e.chat, text);
          await db.gespraechNachricht.create({ data: { gespraechId: g.id, von: "AGENT", text, externId: id || null } });
        } catch (f) {
          await db.gespraechNachricht.create({ data: { gespraechId: g.id, von: "WERKZEUG", text: `Abwesenheitsnotiz nicht gesendet: ${(f as Error).message}` } });
        }
      }
    }
  }
  return ergebnisse;
}

async function senden(zugang: { kanal: Kanal; kennung: string | null; geheim: string | null }, an: string, text: string) {
  const g = geheimLesen(zugang);
  if (zugang.kanal === "TELEGRAM" && g.telegram) return telegramSenden(g.telegram, an, text);
  if (zugang.kanal === "WHATSAPP" && g.whatsapp && zugang.kennung) return whatsappSenden(g.whatsapp, zugang.kennung, an, text);
  if (zugang.kanal === "SMS" && g.sms && zugang.kennung) return smsSenden(g.sms, zugang.kennung, an, text);
  throw new FachFehler(`${KANAL_TEXT[zugang.kanal]} ist nicht vollständig eingerichtet.`);
}

// ------------------------------------------------------------------ Antworten

export async function antworten(b: AktuellerBenutzer, gespraechId: string, text: string) {
  rollePruefen(b);
  const inhalt = text.trim();
  if (!inhalt) throw new FachFehler("Die Nachricht ist leer.");
  if (inhalt.length > 4000) throw new FachFehler("Die Nachricht ist zu lang (höchstens 4.000 Zeichen).");
  const g = await db.gespraech.findUnique({ where: { id: gespraechId } });
  if (!g || g.firmaId !== b.mandant.id) throw new FachFehler("Gespräch nicht gefunden.", "NICHT_GEFUNDEN");
  if (g.kanal === "TELEFON") throw new FachFehler("Auf Anrufe kann man nicht schriftlich antworten. Bitte zurückrufen.");
  const zugang = await db.kanalZugang.findUnique({ where: { firmaId_kanal: { firmaId: g.firmaId, kanal: g.kanal } } });
  if (!zugang?.aktiv) throw new FachFehler(`${KANAL_TEXT[g.kanal]} ist für diese Firma nicht eingeschaltet.`);
  if (g.kanal === "WHATSAPP") {
    const letzte = await db.gespraechNachricht.findFirst({ where: { gespraechId: g.id, von: "KUNDE" }, orderBy: { zeit: "desc" } });
    if (!whatsappFensterOffen(letzte?.zeit ?? null)) {
      throw new FachFehler("WhatsApp erlaubt freie Antworten nur bis 24 Stunden nach der letzten Kundennachricht. Bitte anrufen oder eine E-Mail schreiben.");
    }
  }
  const id = await senden(zugang, g.externId ?? g.absender, inhalt);
  await db.gespraechNachricht.create({ data: { gespraechId: g.id, von: "MITARBEITER", text: inhalt, externId: id || null, benutzerId: b.id } });
  if (g.projektId) await db.logbuchEintrag.create({ data: { projektId: g.projektId, benutzerId: b.id, art: "NOTIZ", text: `${KANAL_TEXT[g.kanal]} gesendet: ${inhalt.slice(0, 300)}` } });
}

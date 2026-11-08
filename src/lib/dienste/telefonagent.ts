/**
 * KI-Telefonagent je Firma. Die Sprachplattform (ElevenLabs mit Claude) führt das Gespräch;
 * das ERP liefert die Werkzeuge und wertet jedes beendete Gespräch aus.
 *
 * Datenschutz: Auskünfte zu Projekten, Angeboten und Terminen gibt es nur, wenn die
 * Rufnummer des Anrufers zu einem Kontakt passt. Ein Name allein reicht nicht.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma, TerminArt } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteNummer } from "../nummern";
import { berlinTag, berlinZuUtc, tagPlus } from "../zeit";
import { angebotSummen, angebotInclude } from "../angebot";
import { verschluesseln, entschluesseln } from "../geheim";
import { kontaktName } from "../format";
import {
  freieTermine, gleicheNummer, istOffen, nummerSchluessel, planText, slotText,
  STANDARD_BUEROZEITEN, STANDARD_TERMINZEITEN, type Wochenplan,
} from "../agent/zeiten";
import { FachFehler } from "./fehler";
import { rollePruefen } from "./zugriff";

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const tagDatum = (tag: string) => berlinZuUtc(tag, "12:00");

export type Weiterleitung = { name: string; nummer: string; wofuer: string };

// ------------------------------------------------------------------ Einstellungen

const STANDARD_BEGRUESSUNG: Record<string, string> = {
  GBSD: "Guten Tag, hier ist die digitale Assistenz der GBSD GmbH. Ich bin eine KI und nehme Ihr Anliegen auf; das Gespräch wird dafür aufgezeichnet. Was kann ich für Sie tun?",
  RD: "Guten Tag, hier ist die digitale Assistenz von Riedrich und Dremel, Ihr Gärtner von Eden. Ich bin eine KI und nehme Ihr Anliegen auf; das Gespräch wird dafür aufgezeichnet. Was kann ich für Sie tun?",
  KUD: "Guten Tag, hier ist die digitale Assistenz vom Baumdienst Kusche und Dremel. Ich bin eine KI und nehme Ihr Anliegen auf; das Gespräch wird dafür aufgezeichnet. Was kann ich für Sie tun?",
};

/** Einstellungen der Firma; legt beim ersten Aufruf Standardwerte an. */
export async function agentFuerFirma(firmaId: string) {
  const vorhanden = await db.telefonAgent.findUnique({ where: { firmaId }, include: { firma: true } });
  if (vorhanden) return vorhanden;
  const f = await db.firma.findUniqueOrThrow({ where: { id: firmaId } });
  return db.telefonAgent.create({
    data: {
      firmaId, begruessung: STANDARD_BEGRUESSUNG[f.kuerzel] ?? STANDARD_BEGRUESSUNG.GBSD,
      buerozeiten: STANDARD_BUEROZEITEN, terminZeiten: STANDARD_TERMINZEITEN,
      notfallRegel: f.kuerzel === "KUD" || f.kuerzel === "GBSD"
        ? "Ein Baum oder großer Ast ist umgestürzt oder droht zu fallen, auf Straße, Haus, Leitung oder Auto; Menschen sind in Gefahr."
        : null,
    },
    include: { firma: true },
  });
}

export type AgentDaten = Awaited<ReturnType<typeof agentFuerFirma>>;

export const AgentEingabe = z.object({
  aktiv: z.boolean(),
  name: z.string().trim().min(1).max(40),
  begruessung: z.string().trim().min(10, "Die Begrüßung ist zu kurz."),
  anweisungen: z.string().nullish(),
  leistungen: z.string().nullish(),
  buerozeiten: z.record(z.array(z.tuple([z.string(), z.string()]))),
  terminZeiten: z.record(z.array(z.tuple([z.string(), z.string()]))),
  terminDauerMin: z.number().int().min(15).max(480),
  terminVorlaufTage: z.number().int().min(0).max(60),
  terminTageVoraus: z.number().int().min(1).max(120),
  weiterleitungen: z.array(z.object({ name: z.string().trim().min(1), nummer: z.string().trim().min(5), wofuer: z.string().trim().min(1) })),
  notfallNummer: z.string().nullish(),
  notfallRegel: z.string().nullish(),
  standardZustaendigId: z.string().nullish(),
  agentId: z.string().nullish(),
});

export async function agentSpeichern(b: AktuellerBenutzer, eingabe: z.input<typeof AgentEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  const e = AgentEingabe.parse(eingabe);
  if (e.standardZustaendigId) {
    const z = await db.zugriff.findUnique({ where: { benutzerId_firmaId: { benutzerId: e.standardZustaendigId, firmaId: b.mandant.id } } });
    if (!z) throw new FachFehler("Die zuständige Person gehört nicht zu diesem Mandanten.");
  }
  if (e.aktiv && !e.standardZustaendigId) throw new FachFehler("Bitte eine zuständige Person für Rückrufe und Anfragen wählen.");
  await agentFuerFirma(b.mandant.id);
  await db.telefonAgent.update({
    where: { firmaId: b.mandant.id },
    data: {
      ...e, anweisungen: leer(e.anweisungen), leistungen: leer(e.leistungen), notfallNummer: leer(e.notfallNummer),
      notfallRegel: leer(e.notfallRegel), standardZustaendigId: e.standardZustaendigId || null, agentId: leer(e.agentId),
      buerozeiten: e.buerozeiten, terminZeiten: e.terminZeiten, weiterleitungen: e.weiterleitungen,
    },
  });
}

/** Neuer Schlüssel für die Werkzeug-Aufrufe. Der Klartext wird nur einmal angezeigt. */
export async function werkzeugSchluesselErzeugen(b: AktuellerBenutzer) {
  rollePruefen(b, ["ADMIN"]);
  await agentFuerFirma(b.mandant.id);
  const klartext = `agt_${randomBytes(30).toString("base64url")}`;
  await db.telefonAgent.update({ where: { firmaId: b.mandant.id }, data: { schluesselHash: hash(klartext), schluesselVorschau: klartext.slice(-4) } });
  return klartext;
}

export async function webhookGeheimnisSpeichern(b: AktuellerBenutzer, geheimnis: string) {
  rollePruefen(b, ["ADMIN"]);
  if (geheimnis.trim().length < 16) throw new FachFehler("Das Geheimnis ist zu kurz.");
  await agentFuerFirma(b.mandant.id);
  await db.telefonAgent.update({ where: { firmaId: b.mandant.id }, data: { webhookGeheimnis: verschluesseln(geheimnis.trim()) } });
}

// ------------------------------------------------------------------ Anmeldung der Plattform

/** Firma aus dem Kürzel in der URL, Schlüssel aus „Authorization: Bearer …“. */
export async function agentAusAnfrage(kuerzel: string, authorization: string | null) {
  const f = await db.firma.findUnique({ where: { kuerzel: kuerzel.toUpperCase() } });
  if (!f) return null;
  const a = await db.telefonAgent.findUnique({ where: { firmaId: f.id }, include: { firma: true } });
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!a?.schluesselHash || !token) return null;
  const soll = Buffer.from(a.schluesselHash, "hex"), ist = Buffer.from(hash(token), "hex");
  return soll.length === ist.length && timingSafeEqual(soll, ist) ? a : null;
}

/**
 * Signatur der Plattform prüfen. ElevenLabs sendet „ElevenLabs-Signature: t=<unix>,v0=<hex>“,
 * v0 = HMAC-SHA256(geheimnis, "<t>.<body>"). Älter als 30 Minuten wird abgelehnt.
 */
export function signaturGueltig(geheimnisVerschluesselt: string | null, kopf: string | null, body: string, jetzt = Date.now()) {
  if (!geheimnisVerschluesselt || !kopf) return false;
  const teile = Object.fromEntries(kopf.split(",").map((t) => t.trim().split("=") as [string, string]));
  const t = Number(teile.t);
  if (!Number.isFinite(t) || Math.abs(jetzt / 1000 - t) > 1800 || !teile.v0) return false;
  const soll = createHmac("sha256", entschluesseln(geheimnisVerschluesselt)).update(`${t}.${body}`).digest();
  const ist = Buffer.from(teile.v0, "hex");
  return soll.length === ist.length && timingSafeEqual(soll, ist);
}

// ------------------------------------------------------------------ Gespräch und Kontakt

async function gespraechHolen(a: AgentDaten, externId: string | null | undefined, anrufer: string | null | undefined) {
  const absender = leer(anrufer) ?? "unbekannt";
  if (!externId) return null;
  return db.gespraech.upsert({
    where: { firmaId_kanal_externId: { firmaId: a.firmaId, kanal: "TELEFON", externId } },
    update: {},
    create: { firmaId: a.firmaId, kanal: "TELEFON", externId, absender, zustaendigId: a.standardZustaendigId },
  });
}

async function werkzeugProtokoll(gespraechId: string | undefined, text: string, daten: Prisma.GespraechUpdateInput = {}) {
  if (!gespraechId) return;
  await db.gespraech.update({ where: { id: gespraechId }, data: { ...daten, nachrichten: { create: { von: "WERKZEUG", text } } } });
}

/** Kontakte, deren Telefon-, Mobil- oder Ansprechpartnernummer zur Rufnummer passt. */
export async function kontakteZurNummer(nummer: string | null | undefined) {
  const schluessel = nummerSchluessel(nummer);
  if (schluessel.length < 6) return [];
  const ende = schluessel.slice(-6);
  // Vorfilter in der Datenbank über die letzten Ziffern, genauer Vergleich danach
  const kandidaten = await db.kontakt.findMany({
    where: {
      geloescht: false,
      OR: [
        { telefon: { contains: ende.slice(-4) } }, { mobil: { contains: ende.slice(-4) } },
        { ansprechpartner: { some: { telefon: { contains: ende.slice(-4) } } } },
      ],
    },
    include: { ansprechpartner: true, adressen: true },
    take: 200,
  });
  return kandidaten.filter((k) => [k.telefon, k.mobil, ...k.ansprechpartner.map((p) => p.telefon)].some((n) => gleicheNummer(n, nummer)));
}

// ------------------------------------------------------------------ Werkzeuge

export const W = {
  kunde_suchen: z.object({ anrufer: z.string().nullish(), gespraech_id: z.string().nullish() }),
  anfrage_anlegen: z.object({
    anrufer: z.string().nullish(), gespraech_id: z.string().nullish(),
    rueckrufnummer: z.string().nullish(), anrede: z.string().nullish(), vorname: z.string().nullish(), nachname: z.string().nullish(),
    firma: z.string().nullish(), email: z.string().nullish(), strasse: z.string().nullish(), plz: z.string().nullish(), ort: z.string().nullish(),
    titel: z.string().trim().min(3), anliegen: z.string().trim().min(3), dringend: z.boolean().nullish(),
  }),
  freie_termine: z.object({ ab_datum: z.string().nullish(), art: z.string().nullish(), gespraech_id: z.string().nullish() }),
  termin_buchen: z.object({
    anrufer: z.string().nullish(), gespraech_id: z.string().nullish(),
    beginn: z.string().min(10), art: z.enum(["BESICHTIGUNG", "BERATUNG", "RUECKRUF"]).default("BESICHTIGUNG"),
    name: z.string().trim().min(2), ort: z.string().nullish(), anliegen: z.string().trim().min(3), projektnummer: z.string().nullish(),
  }),
  angebot_status: z.object({ anrufer: z.string().nullish(), gespraech_id: z.string().nullish(), angebotsnummer: z.string().nullish() }),
  rueckruf_anlegen: z.object({
    anrufer: z.string().nullish(), gespraech_id: z.string().nullish(), rueckrufnummer: z.string().nullish(),
    name: z.string().trim().min(2), anliegen: z.string().trim().min(3), dringend: z.boolean().nullish(), fuer: z.string().nullish(),
  }),
  buerozeiten: z.object({ gespraech_id: z.string().nullish() }),
};
export type WerkzeugName = keyof typeof W;

const STATUS_ANGEBOT = { ENTWURF: "in Bearbeitung", VERSENDET: "verschickt, wartet auf Ihre Antwort", ANGENOMMEN: "angenommen", ABGELEHNT: "abgelehnt", ERSETZT: "durch eine neuere Fassung ersetzt" } as const;

async function angeboteVon(a: AgentDaten, kontaktIds: string[]) {
  const liste = await db.angebot.findMany({
    where: { firmaId: a.firmaId, projekt: { kontaktId: { in: kontaktIds } }, status: { not: "ERSETZT" } },
    include: angebotInclude, orderBy: { datum: "desc" }, take: 5,
  });
  return liste.map((x) => ({
    nummer: x.version > 1 ? `${x.nummer}-${x.version}` : x.nummer,
    art: x.art === "ANGEBOT" ? "Angebot" : "Auftragsbestätigung",
    betreff: x.betreff, datum: berlinTag(x.datum), status: STATUS_ANGEBOT[x.status],
    betrag_brutto: angebotSummen(x).brutto,
    gueltig_bis: x.art === "ANGEBOT" && x.gueltigBis ? berlinTag(x.gueltigBis) : null,
  }));
}

export async function werkzeugAusfuehren(a: AgentDaten, name: WerkzeugName, roh: unknown, jetzt = new Date()): Promise<Record<string, unknown>> {
  const schema = W[name];
  if (!schema) throw new FachFehler(`Unbekanntes Werkzeug ${name}.`);
  const e = schema.parse(roh) as Record<string, unknown> & { anrufer?: string | null; gespraech_id?: string | null };
  const g = await gespraechHolen(a, e.gespraech_id, e.anrufer);
  const plan = a.buerozeiten as Wochenplan;

  switch (name) {
    case "buerozeiten":
      return { offen: istOffen(plan, jetzt), buerozeiten: planText(plan) };

    case "kunde_suchen": {
      const kontakte = await kontakteZurNummer(e.anrufer);
      if (!kontakte.length) {
        await werkzeugProtokoll(g?.id, "Kunde gesucht: unbekannte Nummer");
        return { gefunden: false, hinweis: "Die Nummer ist uns nicht bekannt. Behandle den Anruf als neue Anfrage." };
      }
      const ids = kontakte.map((k) => k.id);
      const [projekte, termine, angebote] = await Promise.all([
        db.projekt.findMany({ where: { firmaId: a.firmaId, kontaktId: { in: ids }, status: { abgeschlossen: false, verloren: false } }, include: { status: true }, orderBy: { updatedAt: "desc" }, take: 5 }),
        db.termin.findMany({ where: { firmaId: a.firmaId, kontaktId: { in: ids }, abgesagt: false, beginn: { gte: jetzt } }, orderBy: { beginn: "asc" }, take: 3 }),
        angeboteVon(a, ids),
      ]);
      const k = kontakte[0];
      await werkzeugProtokoll(g?.id, `Kunde erkannt: ${kontaktName(k)}`, { kontakt: { connect: { id: k.id } }, absenderName: kontaktName(k), ...(projekte[0] ? { projekt: { connect: { id: projekte[0].id } } } : {}) });
      return {
        gefunden: true,
        name: kontaktName(k), anrede: k.anrede, mehrere_kontakte: kontakte.length > 1,
        ort: k.adressen[0]?.ort ?? null,
        offene_projekte: projekte.map((p) => ({ nummer: p.nummer, titel: p.titel, stand: p.status.name })),
        angebote,
        naechste_termine: termine.map((t) => ({ wann: slotText(t.beginn), art: t.art, titel: t.titel })),
      };
    }

    case "anfrage_anlegen": {
      const x = e as z.infer<typeof W.anfrage_anlegen>;
      const nummer = leer(x.rueckrufnummer) ?? leer(x.anrufer);
      if (!leer(x.nachname) && !leer(x.firma)) throw new FachFehler("Bitte nach dem Namen fragen (Nachname oder Firma).");
      const vorhanden = (await kontakteZurNummer(nummer))[0] ?? null;
      const ersterStatus = await db.pipelineStatus.findFirstOrThrow({ where: { firmaId: a.firmaId }, orderBy: { reihenfolge: "asc" } });
      const r = await db.$transaction(async (tx) => {
        const kontakt = vorhanden ?? (await tx.kontakt.create({
          data: {
            anrede: leer(x.anrede), vorname: leer(x.vorname), nachname: leer(x.nachname), firmenname: leer(x.firma),
            email: leer(x.email)?.toLowerCase() ?? null, telefon: nummer, kategorie: leer(x.firma) ? "GEWERBE" : "PRIVAT",
            adressen: leer(x.strasse) || leer(x.ort) ? { create: { art: "HAUPT", strasse: leer(x.strasse), plz: leer(x.plz), ort: leer(x.ort) } } : undefined,
          },
        }));
        const pnr = await naechsteNummer(tx, a.firmaId, "PROJEKT");
        const projekt = await tx.projekt.create({
          data: {
            firmaId: a.firmaId, nummer: pnr, titel: x.titel, kontaktId: kontakt.id, statusId: ersterStatus.id, quelle: "Telefonagent",
            beschreibung: x.anliegen, baustelleStrasse: leer(x.strasse), baustellePlz: leer(x.plz), baustelleOrt: leer(x.ort),
            verantwortlichId: a.standardZustaendigId,
            logbuch: { create: { art: "ANRUF", text: `Anfrage am Telefon (KI-Agent): ${x.anliegen}` } },
          },
        });
        await tx.aufgabe.create({
          data: {
            firmaId: a.firmaId, titel: `${x.dringend ? "DRINGEND: " : ""}Anfrage vom Telefonagenten bearbeiten`, notiz: x.anliegen,
            faelligAm: tagDatum(x.dringend ? berlinTag(jetzt) : tagPlus(berlinTag(jetzt), 1)), zustaendigId: a.standardZustaendigId,
            kontaktId: kontakt.id, projektId: projekt.id,
          },
        });
        return { kontakt, projekt };
      });
      await werkzeugProtokoll(g?.id, `Anfrage angelegt: Projekt ${r.projekt.nummer} „${x.titel}“`, {
        kontakt: { connect: { id: r.kontakt.id } }, projekt: { connect: { id: r.projekt.id } }, absenderName: kontaktName(r.kontakt),
        anliegen: x.titel, dringend: !!x.dringend, ergebnis: "Anfrage angelegt",
      });
      return { angelegt: true, projektnummer: r.projekt.nummer, kunde_war_bekannt: !!vorhanden, naechster_schritt: "Ein Mitarbeiter meldet sich, in der Regel am nächsten Werktag." };
    }

    case "freie_termine": {
      const x = e as z.infer<typeof W.freie_termine>;
      const belegt = await db.termin.findMany({ where: { firmaId: a.firmaId, abgesagt: false, ende: { gte: jetzt } }, select: { beginn: true, ende: true } });
      const slots = freieTermine({
        plan: a.terminZeiten as Wochenplan, dauerMin: a.terminDauerMin, vorlaufTage: a.terminVorlaufTage, tageVoraus: a.terminTageVoraus,
        belegt, jetzt, abTag: /^\d{4}-\d{2}-\d{2}$/.test(x.ab_datum ?? "") ? x.ab_datum! : undefined, anzahl: 6, jeTag: 2,
      });
      await werkzeugProtokoll(g?.id, `Freie Termine angeboten: ${slots.map((s) => s.text).join("; ") || "keine"}`);
      return { termine: slots.map((s) => ({ beginn: s.beginn.toISOString(), text: s.text })), hinweis: slots.length ? "Biete höchstens drei an." : "Keine freien Termine im Planungszeitraum. Lege einen Rückruf an." };
    }

    case "termin_buchen": {
      const x = e as z.infer<typeof W.termin_buchen>;
      const beginn = new Date(x.beginn);
      if (Number.isNaN(beginn.getTime())) throw new FachFehler("Ungültiger Termin. Nutze genau einen Wert aus freie_termine.");
      const ende = new Date(beginn.getTime() + a.terminDauerMin * 60000);
      // Nur Termine aus dem eigenen Raster, und erneut prüfen, ob der Platz noch frei ist
      const belegt = await db.termin.findMany({ where: { firmaId: a.firmaId, abgesagt: false, ende: { gte: jetzt } }, select: { beginn: true, ende: true } });
      const passt = freieTermine({
        plan: a.terminZeiten as Wochenplan, dauerMin: a.terminDauerMin, vorlaufTage: a.terminVorlaufTage, tageVoraus: a.terminTageVoraus,
        belegt, jetzt, abTag: berlinTag(beginn), anzahl: 50, jeTag: 50,
      }).some((s) => s.beginn.getTime() === beginn.getTime());
      if (!passt) return { gebucht: false, hinweis: "Dieser Termin ist nicht mehr frei. Rufe freie_termine erneut auf." };
      const kontakt = (await kontakteZurNummer(x.anrufer))[0] ?? null;
      const projekt = x.projektnummer
        ? await db.projekt.findFirst({ where: { firmaId: a.firmaId, nummer: x.projektnummer, ...(kontakt ? { kontaktId: kontakt.id } : {}) } })
        : g?.projektId ? await db.projekt.findUnique({ where: { id: g.projektId } }) : null;
      const t = await db.termin.create({
        data: {
          firmaId: a.firmaId, art: x.art as TerminArt, titel: `${{ BESICHTIGUNG: "Besichtigung", BERATUNG: "Beratung", RUECKRUF: "Rückruf" }[x.art]}: ${x.name}`,
          beginn, ende, ort: leer(x.ort), notiz: `${x.anliegen}\nTelefon: ${x.anrufer ?? "unbekannt"}`, quelle: "Telefonagent",
          kontaktId: kontakt?.id ?? projekt?.kontaktId ?? null, projektId: projekt?.id ?? null, zustaendigId: a.standardZustaendigId, gespraechId: g?.id ?? null,
        },
      });
      if (projekt) await db.logbuchEintrag.create({ data: { projektId: projekt.id, art: "TERMIN", text: `Termin vom Telefonagenten gebucht: ${slotText(beginn)}` } });
      await werkzeugProtokoll(g?.id, `Termin gebucht: ${slotText(beginn)}`, { ergebnis: "Termin gebucht" });
      return { gebucht: true, termin: slotText(t.beginn), dauer_minuten: a.terminDauerMin, ort: t.ort };
    }

    case "angebot_status": {
      const x = e as z.infer<typeof W.angebot_status>;
      const kontakte = await kontakteZurNummer(x.anrufer);
      if (!kontakte.length) return { auskunft: false, hinweis: "Zu dieser Rufnummer kennen wir keinen Kunden. Aus Datenschutzgründen nennen wir keine Angebotsdaten. Biete einen Rückruf an." };
      let angebote = await angeboteVon(a, kontakte.map((k) => k.id));
      if (x.angebotsnummer) {
        const s = x.angebotsnummer.replace(/\s/g, "").toUpperCase();
        angebote = angebote.filter((y) => y.nummer.replace(/\s/g, "").toUpperCase().includes(s));
      }
      await werkzeugProtokoll(g?.id, `Angebotsstand abgefragt (${angebote.length} gefunden)`);
      return { auskunft: true, angebote };
    }

    case "rueckruf_anlegen": {
      const x = e as z.infer<typeof W.rueckruf_anlegen>;
      const nummer = leer(x.rueckrufnummer) ?? leer(x.anrufer);
      const kontakt = (await kontakteZurNummer(nummer))[0] ?? null;
      let zustaendigId = a.standardZustaendigId;
      if (x.fuer) {
        const m = await db.benutzer.findFirst({ where: { aktiv: true, name: { contains: x.fuer, mode: "insensitive" }, zugriffe: { some: { firmaId: a.firmaId } } } });
        if (m) zustaendigId = m.id;
      }
      await db.aufgabe.create({
        data: {
          firmaId: a.firmaId, titel: `${x.dringend ? "DRINGEND: " : ""}Rückruf ${x.name} ${nummer ?? ""}`.trim(), notiz: x.anliegen,
          faelligAm: tagDatum(berlinTag(jetzt)), zustaendigId, kontaktId: kontakt?.id ?? null, projektId: g?.projektId ?? null,
        },
      });
      await werkzeugProtokoll(g?.id, `Rückruf angelegt für ${x.name}`, { ergebnis: "Rückruf angelegt", dringend: !!x.dringend, anliegen: x.anliegen.slice(0, 200) });
      return { angelegt: true, hinweis: istOffen(plan, jetzt) ? "Rückruf heute während der Bürozeiten." : `Rückruf am nächsten Werktag. Bürozeiten: ${planText(plan)}` };
    }
  }
}

// ------------------------------------------------------------------ Nach dem Gespräch

export const AnrufEnde = z.object({
  type: z.string().optional(),
  data: z.object({
    conversation_id: z.string(),
    agent_id: z.string().optional(),
    transcript: z.array(z.object({ role: z.string(), message: z.string().nullish(), time_in_call_secs: z.number().nullish() })).default([]),
    metadata: z.object({
      start_time_unix_secs: z.number().nullish(),
      call_duration_secs: z.number().nullish(),
      phone_call: z.object({ external_number: z.string().nullish() }).passthrough().nullish(),
    }).passthrough().nullish(),
    analysis: z.object({ transcript_summary: z.string().nullish(), call_summary_title: z.string().nullish() }).passthrough().nullish(),
    conversation_initiation_client_data: z.object({ dynamic_variables: z.record(z.unknown()).nullish() }).passthrough().nullish(),
  }).passthrough(),
});

/**
 * Beendetes Gespräch übernehmen: Verlauf, Zusammenfassung, Zuordnung zu Kontakt und Projekt,
 * Logbuch. Hat der Agent nichts angelegt (keine Anfrage, kein Termin, kein Rückruf),
 * entsteht eine Aufgabe „Anruf prüfen“ – kein Anruf geht verloren.
 */
export async function anrufBeendet(a: AgentDaten, roh: unknown) {
  const { data: d } = AnrufEnde.parse(roh);
  const dyn = d.conversation_initiation_client_data?.dynamic_variables ?? {};
  const anrufer = (d.metadata?.phone_call?.external_number ?? (dyn["system__caller_id"] as string | undefined) ?? null) || null;
  const g = (await gespraechHolen(a, d.conversation_id, anrufer))!;
  const kontakt = g.kontaktId ? null : (await kontakteZurNummer(anrufer))[0] ?? null;
  const zusammenfassung = leer(d.analysis?.transcript_summary);
  const beginn = d.metadata?.start_time_unix_secs ? new Date(d.metadata.start_time_unix_secs * 1000) : g.beginn;

  const aktualisiert = await db.$transaction(async (tx) => {
    await tx.gespraechNachricht.deleteMany({ where: { gespraechId: g.id, von: { in: ["KUNDE", "AGENT"] } } });
    await tx.gespraechNachricht.createMany({
      data: d.transcript.filter((t) => leer(t.message)).map((t) => ({
        gespraechId: g.id, von: t.role === "user" ? "KUNDE" : "AGENT", text: t.message!.trim(),
        zeit: new Date(beginn.getTime() + (t.time_in_call_secs ?? 0) * 1000),
      })),
    });
    return tx.gespraech.update({
      where: { id: g.id },
      data: {
        absender: anrufer ?? g.absender, beginn, dauerSek: d.metadata?.call_duration_secs ?? null, zusammenfassung,
        anliegen: g.anliegen ?? leer(d.analysis?.call_summary_title) ?? zusammenfassung?.slice(0, 200) ?? null,
        ...(kontakt ? { kontaktId: kontakt.id, absenderName: kontaktName(kontakt) } : {}),
      },
    });
  });

  const text = `Anruf (KI-Agent)${aktualisiert.dauerSek ? `, ${Math.round(aktualisiert.dauerSek / 60)} min` : ""}: ${zusammenfassung ?? "ohne Zusammenfassung"}`;
  if (aktualisiert.projektId) await db.logbuchEintrag.create({ data: { projektId: aktualisiert.projektId, art: "ANRUF", text } });
  else if (aktualisiert.kontaktId) await db.logbuchEintrag.create({ data: { kontaktId: aktualisiert.kontaktId, firmaId: a.firmaId, art: "ANRUF", text } });
  if (!aktualisiert.ergebnis) {
    await db.aufgabe.create({
      data: {
        firmaId: a.firmaId, titel: `Anruf prüfen: ${aktualisiert.absenderName ?? anrufer ?? "unbekannte Nummer"}`,
        notiz: zusammenfassung ?? "Der Agent hat nichts angelegt. Bitte Verlauf ansehen.",
        faelligAm: tagDatum(berlinTag(new Date())), zustaendigId: a.standardZustaendigId, kontaktId: aktualisiert.kontaktId, projektId: aktualisiert.projektId,
      },
    });
  }
  return aktualisiert;
}

// ------------------------------------------------------------------ Einrichtung

/** Systemanweisung für die Sprachplattform – aus den Einstellungen der Firma erzeugt. */
export function systemAnweisung(a: AgentDaten) {
  const wl = (a.weiterleitungen as Weiterleitung[]) ?? [];
  return [
    `Du bist ${a.name}, die telefonische KI-Assistenz der ${a.firma.name}${a.firma.zusatz ? ` (${a.firma.zusatz})` : ""}${a.firma.ort ? ` in ${a.firma.ort}` : ""}.`,
    "Du nimmst Anrufe an, wenn im Büro niemand rangeht. Sprich Deutsch, siez die Anrufer, antworte kurz und freundlich, stelle eine Frage nach der anderen.",
    "Sag offen, dass du eine KI bist, wenn danach gefragt wird. Erfinde nie Preise, Termine oder Zusagen. Nenne keine Daten anderer Kunden.",
    "",
    "Ablauf:",
    "1. Rufe zu Beginn kunde_suchen mit der Rufnummer des Anrufers auf ({{system__caller_id}}). Ist der Kunde bekannt, sprich ihn mit Namen an.",
    "2. Kläre das Anliegen. Neue Anfrage: frage nach Name, Adresse des Grundstücks, Rückrufnummer, E-Mail und worum es geht. Lege sie mit anfrage_anlegen an und nenne die Projektnummer.",
    "3. Besichtigung oder Beratung gewünscht: hole mit freie_termine Vorschläge, biete höchstens drei an und buche den gewählten mit termin_buchen. Nenne Tag und Uhrzeit zur Bestätigung.",
    "4. Frage nach einem Angebot: nutze angebot_status. Gibt es keine Auskunft, biete einen Rückruf an.",
    "5. Wer einen bestimmten Mitarbeiter sprechen will oder etwas klären muss, das du nicht lösen kannst: lege mit rueckruf_anlegen einen Rückruf an" + (wl.length ? " oder verbinde während der Bürozeiten weiter (siehe unten)." : "."),
    "6. Fasse am Ende zusammen, was passiert und was als Nächstes geschieht, und verabschiede dich.",
    "",
    `Bürozeiten: ${planText(a.buerozeiten as Wochenplan) || "keine angegeben"}. Nutze das Werkzeug buerozeiten, wenn du wissen musst, ob gerade geöffnet ist.`,
    ...(wl.length ? ["", "Weiterverbinden (Werkzeug transfer_to_number, nur während der Bürozeiten):", ...wl.map((w) => `- ${w.name}, ${w.nummer}: ${w.wofuer}`)] : []),
    ...(a.notfallNummer ? ["", `Notfall: ${a.notfallRegel ?? "Gefahr für Menschen oder Sachen"}. Dann sofort, auch außerhalb der Bürozeiten, an ${a.notfallNummer} weiterverbinden; klappt das nicht, rueckruf_anlegen mit dringend=true.`] : []),
    ...(a.leistungen ? ["", "Leistungen der Firma:", a.leistungen] : []),
    ...(a.anweisungen ? ["", "Weitere Regeln der Firma:", a.anweisungen] : []),
    "",
    "Gib bei jedem Werkzeugaufruf anrufer={{system__caller_id}} und gespraech_id={{system__conversation_id}} mit.",
  ].join("\n");
}

/** Werkzeugbeschreibungen für die Sprachplattform (Server-Werkzeuge, POST mit JSON). */
export function werkzeugDefinitionen(basisUrl: string, kuerzel: string) {
  const s = (beschreibung: string) => ({ type: "string", description: beschreibung });
  const basis = { anrufer: s("Rufnummer des Anrufers: {{system__caller_id}}"), gespraech_id: s("{{system__conversation_id}}") };
  const def = (name: WerkzeugName, beschreibung: string, felder: Record<string, unknown>, pflicht: string[] = []) => ({
    name, description: beschreibung, type: "webhook",
    api_schema: {
      url: `${basisUrl}/api/agent/${kuerzel.toLowerCase()}/werkzeug/${name}`, method: "POST",
      request_headers: { Authorization: "Bearer <Werkzeug-Schlüssel>" },
      request_body_schema: { type: "object", properties: { ...basis, ...felder }, required: pflicht },
    },
  });
  return [
    def("kunde_suchen", "Sucht den Anrufer anhand seiner Rufnummer. Zu Beginn jedes Gesprächs aufrufen.", {}),
    def("anfrage_anlegen", "Legt eine neue Anfrage mit Kontakt, Projekt und Wiedervorlage an.", {
      rueckrufnummer: s("Rückrufnummer, falls abweichend"), anrede: s("Frau, Herr, Familie"), vorname: s("Vorname"), nachname: s("Nachname"),
      firma: s("Firmenname bei Gewerbekunden"), email: s("E-Mail"), strasse: s("Straße und Hausnummer des Grundstücks"), plz: s("PLZ"), ort: s("Ort"),
      titel: s("Kurzer Titel, z. B. 'Heckenschnitt 30 m'"), anliegen: s("Was der Kunde möchte, mit allen Details"), dringend: { type: "boolean", description: "Eilt es?" },
    }, ["titel", "anliegen"]),
    def("freie_termine", "Liefert freie Termine für Besichtigung oder Beratung.", { ab_datum: s("Frühester Tag JJJJ-MM-TT, optional"), art: s("BESICHTIGUNG oder BERATUNG") }),
    def("termin_buchen", "Bucht einen Termin aus freie_termine.", {
      beginn: s("Genau der Wert 'beginn' aus freie_termine"), art: s("BESICHTIGUNG, BERATUNG oder RUECKRUF"), name: s("Name des Kunden"),
      ort: s("Adresse des Termins"), anliegen: s("Worum es geht"), projektnummer: s("Projektnummer, falls bekannt"),
    }, ["beginn", "name", "anliegen"]),
    def("angebot_status", "Nennt Stand und Betrag der Angebote des Anrufers (nur bei bekannter Rufnummer).", { angebotsnummer: s("Angebotsnummer, falls genannt") }),
    def("rueckruf_anlegen", "Legt einen Rückruf für das Büro oder einen bestimmten Mitarbeiter an.", {
      rueckrufnummer: s("Rückrufnummer, falls abweichend"), name: s("Name des Anrufers"), anliegen: s("Worum es geht"),
      dringend: { type: "boolean", description: "Eilt es?" }, fuer: s("Name des gewünschten Mitarbeiters"),
    }, ["name", "anliegen"]),
    def("buerozeiten", "Sagt, ob das Büro gerade besetzt ist, und nennt die Bürozeiten.", {}),
  ];
}

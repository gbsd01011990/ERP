import { z } from "zod";
import type { Postfach, Prisma } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { verschluesseln, entschluesseln } from "../geheim";
import { appToken, graph, graphPost, postfachPfad, MicrosoftFehler, NACHRICHT_FELDER, type GraphNachricht, type GraphAdresse, type MsZugang } from "../microsoft";
import { htmlZuText, adresseNormal, textZuHtml, adressenLesen } from "../mailtext";
import { FachFehler } from "./fehler";
import { eingangErfassen } from "./einkauf";
import { rollePruefen } from "./zugriff";

const TEXT_MAX = 50_000;
const ERSTER_ABRUF_TAGE = 30;

// ------------------------------------------------------------ Microsoft-Zugang je Mandant

/** Zugangsdaten der Firma, ersatzweise aus der Umgebung. null = nicht eingerichtet. */
export async function msZugang(firmaId: string): Promise<MsZugang | null> {
  const f = await db.firma.findUniqueOrThrow({ where: { id: firmaId } });
  const tenantId = f.msTenantId || process.env.MS_TENANT_ID;
  const clientId = f.msClientId || process.env.MS_CLIENT_ID;
  const clientSecret = f.msClientSecret ? entschluesseln(f.msClientSecret) : process.env.MS_CLIENT_SECRET;
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

async function tokenFuer(firmaId: string) {
  const z = await msZugang(firmaId);
  if (!z) throw new FachFehler("Microsoft 365 ist für diesen Mandanten noch nicht eingerichtet (Einstellungen → Postfächer).");
  return appToken(z);
}

export const MsEingabe = z.object({
  tenantId: z.string().trim().min(1, "Verzeichnis-ID (Tenant) fehlt."),
  clientId: z.string().trim().min(1, "Anwendungs-ID (Client) fehlt."),
  /** leer = bisheriges Secret behalten */
  clientSecret: z.string().nullish(),
});

export async function msZugangSpeichern(b: AktuellerBenutzer, eingabe: z.input<typeof MsEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  const e = MsEingabe.parse(eingabe);
  const f = await db.firma.findUniqueOrThrow({ where: { id: b.mandant.id } });
  if (!e.clientSecret && !f.msClientSecret) throw new FachFehler("Geheimer Clientschlüssel fehlt.");
  const secret = e.clientSecret ? e.clientSecret.trim() : entschluesseln(f.msClientSecret!);
  await appToken({ tenantId: e.tenantId, clientId: e.clientId, clientSecret: secret }, true); // Zugang frisch prüfen, bevor gespeichert wird
  await db.firma.update({
    where: { id: f.id },
    data: { msTenantId: e.tenantId, msClientId: e.clientId, ...(e.clientSecret ? { msClientSecret: verschluesseln(e.clientSecret.trim()) } : {}) },
  });
}

// ------------------------------------------------------------ Postfächer und Freigaben

export const PostfachEingabe = z.object({
  art: z.enum(["PERSOENLICH", "GETEILT"]),
  adresse: z.string().trim().toLowerCase().email("Bitte eine gültige Postfachadresse angeben."),
  name: z.string().nullish(),
  /** Inhaber bei persönlichen Postfächern */
  benutzerId: z.string().nullish(),
  /** Freigaben bei geteilten Postfächern */
  zugriffe: z.array(z.string()).default([]),
  /** Anhänge als Eingangsrechnung erfassen (z. B. rechnung@) */
  rechnungseingang: z.boolean().default(false),
});

/** Admin legt ein Postfach an oder ändert Freigaben. Vorher wird geprüft, ob Microsoft den Zugriff erlaubt. */
export async function postfachSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: z.input<typeof PostfachEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  const e = PostfachEingabe.parse(eingabe);
  const mitarbeiter = await db.zugriff.findMany({ where: { firmaId: b.mandant.id }, select: { benutzerId: true } });
  const erlaubt = new Set(mitarbeiter.map((m) => m.benutzerId));
  if (e.art === "PERSOENLICH") {
    if (!e.benutzerId || !erlaubt.has(e.benutzerId)) throw new FachFehler("Für ein persönliches Postfach bitte den Mitarbeiter wählen.");
  }
  if (e.zugriffe.some((z) => !erlaubt.has(z))) throw new FachFehler("Freigaben nur für Mitarbeiter dieses Mandanten.");

  const alt = id ? await db.postfach.findUnique({ where: { id } }) : null;
  if (id && (!alt || alt.firmaId !== b.mandant.id)) throw new FachFehler("Postfach nicht gefunden.", "NICHT_GEFUNDEN");
  if (!alt || alt.adresse !== e.adresse) {
    const token = await tokenFuer(b.mandant.id);
    await graph(token, `${postfachPfad(e.adresse)}/mailFolders/inbox?$select=id`); // wirft mit verständlicher Meldung
  }
  const daten = { art: e.art, adresse: e.adresse, name: e.name?.trim() || null, benutzerId: e.art === "PERSOENLICH" ? e.benutzerId! : null, rechnungseingang: e.rechnungseingang, aktiv: true, fehler: null };
  try {
    return await db.$transaction(async (tx) => {
      const p = alt
        ? await tx.postfach.update({ where: { id: alt.id }, data: { ...daten, ...(alt.adresse !== e.adresse ? { deltaPosteingang: null, deltaGesendet: null } : {}) } })
        : await tx.postfach.create({ data: { ...daten, firmaId: b.mandant.id, abrufAb: new Date(Date.now() - ERSTER_ABRUF_TAGE * 864e5) } });
      await tx.postfachZugriff.deleteMany({ where: { postfachId: p.id } });
      if (e.art === "GETEILT" && e.zugriffe.length) {
        await tx.postfachZugriff.createMany({ data: [...new Set(e.zugriffe)].map((benutzerId) => ({ postfachId: p.id, benutzerId })) });
      }
      return p;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new FachFehler(`Das Postfach ${e.adresse} ist schon angelegt.`);
    throw err;
  }
}

export async function postfachEntfernen(b: AktuellerBenutzer, id: string) {
  rollePruefen(b, ["ADMIN"]);
  const p = await db.postfach.findUnique({ where: { id } });
  if (!p || p.firmaId !== b.mandant.id) throw new FachFehler("Postfach nicht gefunden.", "NICHT_GEFUNDEN");
  // Abgerufene Mails bleiben bei Kontakten und Projekten erhalten: Postfach nur abschalten
  await db.postfach.update({ where: { id }, data: { aktiv: false } });
}

/**
 * Postfächer, die der Benutzer lesen und aus denen er senden darf: sein persönliches und die
 * geteilten mit Freigabe. Admins verwalten Postfächer, lesen fremde aber nur mit Freigabe.
 */
export const meinePostfaecher = (b: AktuellerBenutzer) =>
  db.postfach.findMany({
    where: { firmaId: b.mandant.id, aktiv: true, OR: [{ benutzerId: b.id }, { art: "GETEILT", zugriffe: { some: { benutzerId: b.id } } }] },
    orderBy: [{ art: "asc" }, { adresse: "asc" }],
  });

/**
 * Sichtbarkeit von Mails: aus eigenen/freigegebenen Postfächern immer; zugeordnete Mails
 * (Kontakt oder Projekt) zusätzlich für Büro und Admin, damit Projektkorrespondenz für alle da ist.
 */
export async function emailFilter(b: AktuellerBenutzer): Promise<Prisma.EmailWhereInput> {
  const ids = (await meinePostfaecher(b)).map((p) => p.id);
  return {
    firmaId: b.mandant.id,
    OR: [{ postfachId: { in: ids } }, ...(b.rolle !== "KOLONNE" ? [{ kontaktId: { not: null } }, { projektId: { not: null } }] : [])],
  };
}

export async function emailLaden(b: AktuellerBenutzer, id: string) {
  const m = await db.email.findFirst({ where: { AND: [{ id }, await emailFilter(b)] } });
  if (!m) throw new FachFehler("E-Mail nicht gefunden.", "NICHT_GEFUNDEN");
  return m;
}

// ------------------------------------------------------------ Zuordnung

/** Kontakt zu Adressen finden: Kontakt-E-Mail oder Ansprechpartner-E-Mail (ohne Groß-/Kleinschreibung). */
export async function kontaktZuAdressen(adressen: string[]) {
  const liste = [...new Set(adressen.map(adresseNormal).filter(Boolean))];
  if (!liste.length) return null;
  const oder = liste.flatMap((a) => [
    { email: { equals: a, mode: "insensitive" as const } },
    { ansprechpartner: { some: { email: { equals: a, mode: "insensitive" as const } } } },
  ]);
  return db.kontakt.findFirst({ where: { geloescht: false, OR: oder }, orderBy: { updatedAt: "desc" } });
}

/**
 * Projekt zu einer Mail: 1. gleiche Konversation wie eine bereits zugeordnete Mail,
 * 2. sonst das einzige offene Projekt des Kontakts im Mandanten. Bei mehreren offenen
 * Projekten bleibt das Projekt leer – dann entscheidet ein Mensch.
 */
async function projektFinden(firmaId: string, kontaktId: string | null, konversation: string | null) {
  if (konversation) {
    const vorher = await db.email.findFirst({ where: { firmaId, konversation, projektId: { not: null } }, orderBy: { empfangenAm: "desc" } });
    if (vorher) return vorher.projektId;
  }
  if (!kontaktId) return null;
  const offen = await db.projekt.findMany({ where: { firmaId, kontaktId, status: { abgeschlossen: false } }, select: { id: true }, take: 2 });
  return offen.length === 1 ? offen[0].id : null;
}

const adr = (a?: GraphAdresse) => adresseNormal(a?.emailAddress?.address);

// ------------------------------------------------------------ Abruf

type Ordner = "inbox" | "sentitems";

async function nachrichtSpeichern(p: Postfach, n: GraphNachricht, ordner: Ordner) {
  if (n["@removed"] || n.isDraft) return "uebersprungen";
  const richtung = ordner === "inbox" ? "EINGANG" : "AUSGANG";
  const vonAdresse = adr(n.from) || p.adresse;
  const an = (n.toRecipients ?? []).map(adr).filter(Boolean);
  const cc = (n.ccRecipients ?? []).map(adr).filter(Boolean);
  const empfangenAm = new Date(n.receivedDateTime ?? n.sentDateTime ?? Date.now());
  const roh = n.body?.content ?? n.bodyPreview ?? "";
  const text = (n.body?.contentType === "html" ? htmlZuText(roh) : roh).slice(0, TEXT_MAX);

  const vorhanden = await db.email.findUnique({ where: { postfachId_graphId: { postfachId: p.id, graphId: n.id } } });
  if (vorhanden) {
    if (vorhanden.gelesen !== !!n.isRead) await db.email.update({ where: { id: vorhanden.id }, data: { gelesen: !!n.isRead } });
    return "bekannt";
  }
  // Dieselbe Mail kam schon über ein anderes Postfach des Mandanten (z. B. info@ und persönlich)
  if (n.internetMessageId) {
    const doppelt = await db.email.findFirst({ where: { firmaId: p.firmaId, internetId: n.internetMessageId } });
    if (doppelt) return "doppelt";
  }
  // Aus der App gesendet: Platzhalter durch die echte Nachricht ersetzen
  if (richtung === "AUSGANG") {
    const platzhalter = await db.email.findFirst({
      where: {
        postfachId: p.id, graphId: { startsWith: "gesendet:" },
        betreff: n.subject ?? "",
        empfangenAm: { gte: new Date(empfangenAm.getTime() - 30 * 60000), lte: new Date(empfangenAm.getTime() + 30 * 60000) },
      },
    });
    if (platzhalter) {
      await db.email.update({
        where: { id: platzhalter.id },
        data: { graphId: n.id, internetId: n.internetMessageId ?? null, konversation: n.conversationId ?? null, webLink: n.webLink ?? null, empfangenAm, text: text || platzhalter.text },
      });
      return "ersetzt";
    }
  }

  const partner = richtung === "EINGANG" ? [vonAdresse] : [...an, ...cc];
  const kontakt = await kontaktZuAdressen(partner);
  const projektId = await projektFinden(p.firmaId, kontakt?.id ?? null, n.conversationId ?? null);
  const neu = await db.email.create({
    data: {
      firmaId: p.firmaId, postfachId: p.id, graphId: n.id, internetId: n.internetMessageId ?? null, konversation: n.conversationId ?? null,
      richtung, betreff: n.subject || "(ohne Betreff)", vonName: n.from?.emailAddress?.name ?? null, vonAdresse, an, cc,
      vorschau: n.bodyPreview?.slice(0, 300) ?? null, text, hatAnhaenge: !!n.hasAttachments, webLink: n.webLink ?? null,
      empfangenAm, gelesen: !!n.isRead, kontaktId: kontakt?.id ?? null, projektId, zuordnung: kontakt ? "AUTO" : null,
    },
  });
  return { neu };
}

type GraphAnhang = { "@odata.type"?: string; id: string; name: string; contentType?: string; size?: number; isInline?: boolean; contentBytes?: string };

/** Rechnungseingang: PDF- und XML-Anhänge einer Mail als Eingangsrechnung erfassen. */
async function anhaengeAlsRechnung(token: string, p: Postfach, emailId: string, graphId: string) {
  const r: { value: GraphAnhang[] } = await graph(token, `${postfachPfad(p.adresse)}/messages/${encodeURIComponent(graphId)}/attachments`);
  const dateien = r.value.filter((a) => (a["@odata.type"] ?? "").endsWith("fileAttachment") && !a.isInline && a.contentBytes && /\.(pdf|xml)$/i.test(a.name));
  // XRechnung und Sicht-PDF kommen oft zusammen: dann reicht das XML
  const xml = dateien.filter((a) => /\.xml$/i.test(a.name));
  const auswahl = xml.length ? xml : dateien;
  let anzahl = 0;
  for (const a of auswahl) {
    try {
      await eingangErfassen(p.firmaId, { name: a.name, daten: Buffer.from(a.contentBytes!, "base64") }, "EMAIL", emailId);
      anzahl++;
    } catch (e) {
      // Keine Rechnung (z. B. AGB als PDF, fremdes XML): Mail bleibt im Posteingang
      console.warn(`Anhang ${a.name} nicht als Rechnung erfasst: ${(e as Error).message}`);
    }
  }
  if (anzahl) await db.email.update({ where: { id: emailId }, data: { ignoriert: true, zuordnung: "AUTO" } });
  return anzahl;
}

/** Ruft Posteingang und Gesendete eines Postfachs ab (Delta-Abfrage: nur Änderungen seit dem letzten Abruf). */
export async function postfachAbrufen(postfachId: string) {
  const p = await db.postfach.findUniqueOrThrow({ where: { id: postfachId } });
  if (!p.aktiv) return { neu: 0 };
  const zaehler: Record<string, number> = {};
  try {
    const token = await tokenFuer(p.firmaId);
    for (const ordner of ["inbox", "sentitems"] as Ordner[]) {
      const feld = ordner === "inbox" ? "deltaPosteingang" : "deltaGesendet";
      let url: string | undefined =
        p[feld] ??
        `${postfachPfad(p.adresse)}/mailFolders/${ordner}/messages/delta?$select=${NACHRICHT_FELDER}&$filter=receivedDateTime+ge+${p.abrufAb.toISOString()}`;
      let deltaLink: string | undefined;
      for (let seite = 0; url && seite < 200; seite++) {
        const r: { value: GraphNachricht[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string } = await graph(token, url, {
          Prefer: 'odata.maxpagesize=50, outlook.body-content-type="html"',
        });
        for (const n of r.value) {
          const e = await nachrichtSpeichern(p, n, ordner);
          const art = typeof e === "string" ? e : "neu";
          zaehler[art] = (zaehler[art] ?? 0) + 1;
          if (typeof e !== "string" && p.rechnungseingang && ordner === "inbox" && n.hasAttachments) {
            zaehler.rechnungen = (zaehler.rechnungen ?? 0) + (await anhaengeAlsRechnung(token, p, e.neu.id, n.id));
          }
        }
        url = r["@odata.nextLink"];
        deltaLink = r["@odata.deltaLink"] ?? deltaLink;
      }
      if (deltaLink) await db.postfach.update({ where: { id: p.id }, data: { [feld]: deltaLink } });
    }
    await db.postfach.update({ where: { id: p.id }, data: { letzterAbruf: new Date(), fehler: null } });
  } catch (e) {
    const meldung = e instanceof Error ? e.message : String(e);
    // Abgelaufener Delta-Link (410): beim nächsten Abruf neu beginnen
    const neuBeginnen = e instanceof MicrosoftFehler && e.status === 410 ? { deltaPosteingang: null, deltaGesendet: null } : {};
    await db.postfach.update({ where: { id: p.id }, data: { fehler: meldung.slice(0, 500), ...neuBeginnen } });
    throw e;
  }
  return { neu: zaehler.neu ?? 0, ...zaehler };
}

// ------------------------------------------------------------ Versand

export const SendenEingabe = z.object({
  postfachId: z.string().min(1, "Absender-Postfach fehlt."),
  an: z.string().min(1, "Empfänger fehlt."),
  cc: z.string().nullish(),
  betreff: z.string().trim().min(1, "Betreff fehlt."),
  text: z.string().trim().min(1, "Text fehlt."),
  antwortAufId: z.string().nullish(), // lokale Email-ID
  kontaktId: z.string().nullish(),
  projektId: z.string().nullish(),
  anhaenge: z.array(z.object({ name: z.string(), typ: z.string(), daten: z.instanceof(Buffer) })).default([]),
});

export async function senden(b: AktuellerBenutzer, eingabe: z.input<typeof SendenEingabe>) {
  const e = SendenEingabe.parse(eingabe);
  const p = (await meinePostfaecher(b)).find((x) => x.id === e.postfachId);
  if (!p) throw new FachFehler("Aus diesem Postfach darfst du nicht senden.", "KEIN_ZUGRIFF");
  const an = adressenLesen(e.an), cc = adressenLesen(e.cc ?? "");
  if (an.ungueltig.length || cc.ungueltig.length) throw new FachFehler(`Ungültige Adresse: ${[...an.ungueltig, ...cc.ungueltig].join(", ")}`);
  if (!an.gueltig.length) throw new FachFehler("Empfänger fehlt.");
  if (e.anhaenge.reduce((s, a) => s + a.daten.length, 0) > 3 * 1024 * 1024) throw new FachFehler("Anhänge zusammen über 3 MB – bitte verkleinern.");

  const original = e.antwortAufId ? await emailLaden(b, e.antwortAufId) : null;
  const empfaenger = (l: string[]) => l.map((address) => ({ emailAddress: { address } }));
  const anhaenge = e.anhaenge.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.typ, contentBytes: a.daten.toString("base64") }));
  const token = await tokenFuer(p.firmaId);

  if (original && original.postfachId === p.id && !original.graphId.startsWith("gesendet:")) {
    // Antwort im selben Postfach: Microsoft hängt den Verlauf an und hält die Konversation zusammen
    await graphPost(token, `${postfachPfad(p.adresse)}/messages/${encodeURIComponent(original.graphId)}/reply`, {
      message: { toRecipients: empfaenger(an.gueltig), ccRecipients: empfaenger(cc.gueltig), attachments: anhaenge },
      comment: textZuHtml(e.text),
    });
  } else {
    await graphPost(token, `${postfachPfad(p.adresse)}/sendMail`, {
      message: {
        subject: e.betreff, body: { contentType: "HTML", content: textZuHtml(e.text) },
        toRecipients: empfaenger(an.gueltig), ccRecipients: empfaenger(cc.gueltig), attachments: anhaenge,
      },
      saveToSentItems: true,
    });
  }

  // Sofort sichtbar; der nächste Abruf ersetzt den Platzhalter durch die echte Nachricht
  const betreff = original ? `AW: ${original.betreff.replace(/^((AW|RE|Re|Aw|WG|FW):\s*)+/i, "")}` : e.betreff;
  const kontaktId = e.kontaktId ?? original?.kontaktId ?? (await kontaktZuAdressen(an.gueltig))?.id ?? null;
  const projektId = e.projektId ?? original?.projektId ?? null;
  const mail = await db.email.create({
    data: {
      firmaId: p.firmaId, postfachId: p.id, graphId: `gesendet:${crypto.randomUUID()}`, konversation: original?.konversation ?? null,
      richtung: "AUSGANG", betreff, vonName: b.name, vonAdresse: p.adresse, an: an.gueltig, cc: cc.gueltig,
      vorschau: e.text.slice(0, 300), text: e.text, hatAnhaenge: anhaenge.length > 0, empfangenAm: new Date(), gelesen: true,
      kontaktId, projektId, zuordnung: "HAND",
    },
  });
  if (projektId) {
    await db.logbuchEintrag.create({
      data: { projektId, benutzerId: b.id, art: "EMAIL", text: `E-Mail an ${an.gueltig.join(", ")}: ${betreff}${anhaenge.length ? ` (Anhang: ${e.anhaenge.map((a) => a.name).join(", ")})` : ""}` },
    });
  }
  return mail;
}

// ------------------------------------------------------------ Zuordnen von Hand

export async function emailZuordnen(b: AktuellerBenutzer, emailId: string, kontaktId: string | null, projektId: string | null) {
  const m = await emailLaden(b, emailId);
  if (projektId) {
    const pr = await db.projekt.findUnique({ where: { id: projektId } });
    if (!pr || pr.firmaId !== b.mandant.id) throw new FachFehler("Projekt nicht gefunden.", "NICHT_GEFUNDEN");
    kontaktId = kontaktId ?? pr.kontaktId;
  }
  if (kontaktId && !(await db.kontakt.findUnique({ where: { id: kontaktId } }))) throw new FachFehler("Kontakt nicht gefunden.", "NICHT_GEFUNDEN");
  // Die übrigen Mails derselben Konversation gleich mitnehmen
  const where = m.konversation ? { firmaId: m.firmaId, konversation: m.konversation } : { id: m.id };
  await db.email.updateMany({ where, data: { kontaktId, projektId, zuordnung: "HAND", ignoriert: false } });
  return m;
}

export async function emailIgnorieren(b: AktuellerBenutzer, emailId: string, ignorieren: boolean) {
  const m = await emailLaden(b, emailId);
  return db.email.update({ where: { id: m.id }, data: { ignoriert: ignorieren } });
}

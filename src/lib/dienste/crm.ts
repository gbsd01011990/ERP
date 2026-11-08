import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteNummer } from "../nummern";
import { berlinTag, berlinZuUtc, tagPlus } from "../zeit";
import { adresseNormal } from "../mailtext";
import { FachFehler } from "./fehler";
import { rollePruefen } from "./zugriff";
import { emailLaden, kontaktZuAdressen } from "./mail";

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());
/** Fälligkeitstag als 12:00 Uhr Berliner Zeit speichern, damit kein Zeitzonenwechsel den Tag verschiebt. */
const tagDatum = (tag: string) => berlinZuUtc(tag, "12:00");

// ------------------------------------------------------------ Aufgaben

export const AufgabeEingabe = z.object({
  titel: z.string().trim().min(1, "Titel fehlt."),
  notiz: z.string().nullish(),
  faelligTag: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  zustaendigId: z.string().nullish(),
  kontaktId: z.string().nullish(),
  projektId: z.string().nullish(),
  emailId: z.string().nullish(),
});

async function bezugPruefen(b: AktuellerBenutzer, e: { zustaendigId?: string | null; kontaktId?: string | null; projektId?: string | null }) {
  if (e.zustaendigId) {
    const z = await db.zugriff.findUnique({ where: { benutzerId_firmaId: { benutzerId: e.zustaendigId, firmaId: b.mandant.id } } });
    if (!z) throw new FachFehler("Zuständige Person gehört nicht zu diesem Mandanten.");
  }
  if (e.projektId) {
    const p = await db.projekt.findUnique({ where: { id: e.projektId } });
    if (!p || p.firmaId !== b.mandant.id) throw new FachFehler("Projekt nicht gefunden.", "NICHT_GEFUNDEN");
    return p.kontaktId;
  }
  return e.kontaktId ?? null;
}

export async function aufgabeSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: z.input<typeof AufgabeEingabe>) {
  rollePruefen(b);
  const e = AufgabeEingabe.parse(eingabe);
  const kontaktId = await bezugPruefen(b, e);
  const daten = {
    titel: e.titel, notiz: leer(e.notiz), faelligAm: e.faelligTag ? tagDatum(e.faelligTag) : null,
    zustaendigId: e.zustaendigId || b.id, kontaktId, projektId: e.projektId || null,
  };
  if (!id) {
    if (e.emailId) await emailLaden(b, e.emailId);
    return db.aufgabe.create({ data: { ...daten, firmaId: b.mandant.id, erstelltVonId: b.id, emailId: e.emailId || null } });
  }
  const alt = await db.aufgabe.findUnique({ where: { id } });
  if (!alt || alt.firmaId !== b.mandant.id) throw new FachFehler("Aufgabe nicht gefunden.", "NICHT_GEFUNDEN");
  return db.aufgabe.update({ where: { id }, data: daten });
}

/** Erledigen bzw. wieder öffnen. Beim Erledigen entsteht ein Logbuch-Eintrag am Projekt. */
export async function aufgabeErledigt(b: AktuellerBenutzer, id: string, erledigt: boolean) {
  const a = await db.aufgabe.findUnique({ where: { id } });
  if (!a || a.firmaId !== b.mandant.id) throw new FachFehler("Aufgabe nicht gefunden.", "NICHT_GEFUNDEN");
  if (b.rolle === "KOLONNE" && a.zustaendigId !== b.id) throw new FachFehler("Nur eigene Aufgaben erledigen.", "KEIN_ZUGRIFF");
  const neu = await db.aufgabe.update({ where: { id }, data: { erledigtAm: erledigt ? new Date() : null } });
  if (erledigt && a.projektId) {
    await db.logbuchEintrag.create({ data: { projektId: a.projektId, benutzerId: b.id, art: "SYSTEM", text: `Aufgabe erledigt: ${a.titel}` } });
  }
  return neu;
}

/** Wiedervorlage um n Tage verschieben (ab heute). */
export async function aufgabeVerschieben(b: AktuellerBenutzer, id: string, tage: number) {
  const a = await db.aufgabe.findUnique({ where: { id } });
  if (!a || a.firmaId !== b.mandant.id) throw new FachFehler("Aufgabe nicht gefunden.", "NICHT_GEFUNDEN");
  return db.aufgabe.update({ where: { id }, data: { faelligAm: tagDatum(tagPlus(berlinTag(new Date()), tage)) } });
}

// ------------------------------------------------------------ Kontakt-Notizen

export async function kontaktNotiz(b: AktuellerBenutzer, kontaktId: string, art: "NOTIZ" | "ANRUF" | "EMAIL" | "TERMIN", text: string) {
  rollePruefen(b);
  if (!leer(text)) throw new FachFehler("Text ist leer.");
  if (!(await db.kontakt.findUnique({ where: { id: kontaktId } }))) throw new FachFehler("Kontakt nicht gefunden.", "NICHT_GEFUNDEN");
  return db.logbuchEintrag.create({ data: { kontaktId, firmaId: b.mandant.id, benutzerId: b.id, art, text: text.trim() } });
}

// ------------------------------------------------------------ Anfrage erfassen

export const AnfrageEingabe = z.object({
  anrede: z.string().nullish(),
  vorname: z.string().nullish(),
  nachname: z.string().nullish(),
  firmenname: z.string().nullish(),
  email: z.string().nullish(),
  telefon: z.string().nullish(),
  strasse: z.string().nullish(),
  plz: z.string().nullish(),
  ort: z.string().nullish(),
  titel: z.string().trim().min(1, "Worum geht es? (Titel fehlt)"),
  anliegen: z.string().nullish(),
  quelle: z.string().nullish(),
  wiedervorlageTag: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  zustaendigId: z.string().nullish(),
  /** Anfrage aus einer E-Mail */
  emailId: z.string().nullish(),
});

/**
 * Neue Anfrage in einem Schritt: Kontakt (vorhandener per E-Mail wird wiederverwendet),
 * Projekt im ersten Pipeline-Status, Wiedervorlage und Verknüpfung der Mail(s).
 */
export async function anfrageAnlegen(b: AktuellerBenutzer, eingabe: z.input<typeof AnfrageEingabe>) {
  rollePruefen(b);
  const e = AnfrageEingabe.parse(eingabe);
  const mail = e.emailId ? await emailLaden(b, e.emailId) : null;
  const email = adresseNormal(e.email ?? (mail?.richtung === "EINGANG" ? mail.vonAdresse : null)) || null;
  if (!leer(e.nachname) && !leer(e.firmenname) && !email) throw new FachFehler("Name, Firma oder E-Mail-Adresse angeben.");
  if (e.zustaendigId) {
    const z = await db.zugriff.findUnique({ where: { benutzerId_firmaId: { benutzerId: e.zustaendigId, firmaId: b.mandant.id } } });
    if (!z) throw new FachFehler("Zuständige Person gehört nicht zu diesem Mandanten.");
  }
  const vorhanden = email ? await kontaktZuAdressen([email]) : null;
  const ersterStatus = await db.pipelineStatus.findFirstOrThrow({ where: { firmaId: b.mandant.id }, orderBy: { reihenfolge: "asc" } });
  const faellig = e.wiedervorlageTag ?? tagPlus(berlinTag(new Date()), 1);

  return db.$transaction(async (tx) => {
    const kontakt =
      vorhanden ??
      (await tx.kontakt.create({
        data: {
          anrede: leer(e.anrede), vorname: leer(e.vorname), nachname: leer(e.nachname) ?? (leer(e.firmenname) ? null : email),
          firmenname: leer(e.firmenname), email, telefon: leer(e.telefon), kategorie: leer(e.firmenname) ? "GEWERBE" : "PRIVAT",
          adressen: leer(e.strasse) || leer(e.ort) ? { create: { art: "HAUPT", strasse: leer(e.strasse), plz: leer(e.plz), ort: leer(e.ort) } } : undefined,
        },
      }));
    const nummer = await naechsteNummer(tx, b.mandant.id, "PROJEKT");
    const projekt = await tx.projekt.create({
      data: {
        firmaId: b.mandant.id, nummer, titel: e.titel, kontaktId: kontakt.id, statusId: ersterStatus.id,
        quelle: leer(e.quelle) ?? (mail ? "E-Mail" : null), beschreibung: leer(e.anliegen) ?? mail?.text?.slice(0, 4000) ?? null,
        baustelleStrasse: leer(e.strasse), baustellePlz: leer(e.plz), baustelleOrt: leer(e.ort), verantwortlichId: e.zustaendigId || b.id,
        logbuch: { create: { art: "SYSTEM", text: mail ? `Anfrage aus E-Mail „${mail.betreff}“ angelegt` : "Anfrage erfasst", benutzerId: b.id } },
      },
    });
    if (mail) {
      // Diese Mail, ihre Konversation und weitere offene Mails des Absenders zuordnen
      await tx.email.updateMany({
        where: {
          firmaId: b.mandant.id,
          OR: [{ id: mail.id }, ...(mail.konversation ? [{ konversation: mail.konversation }] : []), ...(email ? [{ vonAdresse: email, kontaktId: null }] : [])],
        },
        data: { kontaktId: kontakt.id, projektId: projekt.id, zuordnung: "HAND", ignoriert: false },
      });
    }
    await tx.aufgabe.create({
      data: {
        firmaId: b.mandant.id, titel: "Anfrage beantworten", faelligAm: tagDatum(faellig), zustaendigId: e.zustaendigId || b.id,
        erstelltVonId: b.id, kontaktId: kontakt.id, projektId: projekt.id, emailId: mail?.id ?? null,
      },
    });
    return { projekt, kontakt, kontaktWarSchonDa: !!vorhanden };
  });
}

/** Vorschlag für Name/Vorname aus dem Absendernamen einer Mail („Erika Muster“, „Muster, Erika“). */
export function nameAusAbsender(vonName: string | null | undefined) {
  const n = (vonName ?? "").replace(/["']/g, "").trim();
  if (!n || n.includes("@")) return { vorname: "", nachname: "" };
  if (n.includes(",")) {
    const [nach, vor] = n.split(",").map((s) => s.trim());
    return { vorname: vor ?? "", nachname: nach };
  }
  const teile = n.split(/\s+/);
  return teile.length === 1 ? { vorname: "", nachname: teile[0] } : { vorname: teile.slice(0, -1).join(" "), nachname: teile.at(-1)! };
}

/**
 * Lieferscheine: Kauf auf Lieferschein (Kleinmaterial im Baustoffhandel, Baumarkt) und
 * Lieferscheine zu Bestellungen. Erfassung per Foto, PDF oder E-Mail.
 *
 * - Jeder darf erfassen, auch Kolonnen (Foto an der Kasse); Kolonnen sehen nur ihre eigenen.
 * - Die Sammelrechnung des Händlers wird gegen die Lieferscheine geprüft; mit der Freigabe
 *   gelten die Lieferscheine als abgerechnet. Offene Lieferscheine zeigen, was noch kommt.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { berlinZuUtc } from "../zeit";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";
import { dateiTyp } from "../einkauf/lieferschein-hilfen";
export { dateiTyp, nummerAusText } from "../einkauf/lieferschein-hilfen";

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());
const MAX_DATEIEN = 10, MAX_GROESSE = 15 * 1024 * 1024;

export type Datei = { name: string; daten: Buffer };

function dateienPruefen(dateien: Datei[]) {
  if (dateien.length > MAX_DATEIEN) throw new FachFehler(`Höchstens ${MAX_DATEIEN} Dateien je Lieferschein.`);
  return dateien.map((d) => {
    if (d.daten.length > MAX_GROESSE) throw new FachFehler(`${d.name} ist größer als 15 MB.`);
    const typ = dateiTyp(d.daten);
    if (!typ) throw new FachFehler(`${d.name}: nur Fotos (JPEG, PNG, WebP, HEIC) oder PDF.`);
    return { name: d.name.replace(/[^\wäöüÄÖÜß.\- ]+/g, "_").slice(0, 120) || "lieferschein", typ, groesse: d.daten.length, hash: createHash("sha256").update(d.daten).digest("hex"), daten: new Uint8Array(d.daten) };
  });
}

export const LieferscheinEingabe = z.object({
  lieferantId: z.string().nullish(),
  lieferantName: z.string().nullish(),
  nummer: z.string().nullish(),
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum fehlt."),
  projektId: z.string().nullish(),
  betrag: z.number().nullish(),
  notiz: z.string().nullish(),
});

async function bezuege(firmaId: string, e: { lieferantId?: string | null; projektId?: string | null }) {
  if (e.lieferantId && !(await db.kontakt.findFirst({ where: { id: e.lieferantId, geloescht: false } }))) throw new FachFehler("Lieferant nicht gefunden.");
  if (e.projektId && !(await db.projekt.findFirst({ where: { id: e.projektId, firmaId } }))) throw new FachFehler("Projekt nicht gefunden.");
}

/** Lieferschein anlegen. Ohne Benutzer (E-Mail-Eingang) zählt die Firma des Postfachs. */
export async function lieferscheinAnlegen(
  wer: { b: AktuellerBenutzer } | { firmaId: string },
  eingabe: z.input<typeof LieferscheinEingabe>,
  dateien: Datei[],
  quelle: "FOTO" | "UPLOAD" | "EMAIL" | "WARENEINGANG",
  extra: { bestellungId?: string | null; wareneingangId?: string | null; emailId?: string | null } = {},
  tx: Prisma.TransactionClient = db as unknown as Prisma.TransactionClient,
) {
  const firmaId = "b" in wer ? wer.b.mandant.id : wer.firmaId;
  if ("b" in wer) rollePruefen(wer.b, ["ADMIN", "BUERO", "KOLONNE"]);
  const e = LieferscheinEingabe.parse(eingabe);
  if (!dateien.length && quelle !== "WARENEINGANG") throw new FachFehler("Bitte ein Foto oder PDF des Lieferscheins anhängen.");
  if (!e.lieferantId && !leer(e.lieferantName) && quelle !== "EMAIL") throw new FachFehler("Bei welchem Händler wurde gekauft? Bitte Lieferant wählen oder eintragen.");
  await bezuege(firmaId, e);
  const geprueft = dateienPruefen(dateien);
  // Dasselbe Foto zweimal hochgeladen (z. B. per E-Mail und von Hand): nicht doppelt anlegen
  if (geprueft.length) {
    const doppelt = await tx.lieferscheinDatei.findFirst({ where: { hash: { in: geprueft.map((d) => d.hash) }, lieferschein: { firmaId } }, include: { lieferschein: true } });
    if (doppelt) {
      if (quelle === "EMAIL") return doppelt.lieferschein;
      throw new FachFehler(`Dieses Foto gehört schon zu Lieferschein ${doppelt.lieferschein.nummer ?? "vom " + doppelt.lieferschein.datum.toLocaleDateString("de-DE")}.`);
    }
  }
  return tx.lieferschein.create({
    data: {
      firmaId, quelle, lieferantId: e.lieferantId || null, lieferantName: leer(e.lieferantName), nummer: leer(e.nummer),
      datum: berlinZuUtc(e.datum, "12:00"), projektId: e.projektId || null, betrag: e.betrag ?? null, notiz: leer(e.notiz),
      erfasstVonId: "b" in wer ? wer.b.id : null, bestellungId: extra.bestellungId ?? null, wareneingangId: extra.wareneingangId ?? null, emailId: extra.emailId ?? null,
      dateien: { create: geprueft },
    },
  });
}

const sichtbar = (b: AktuellerBenutzer): Prisma.LieferscheinWhereInput => ({ firmaId: b.mandant.id, ...(b.rolle === "KOLONNE" ? { erfasstVonId: b.id } : {}) });

export async function lieferscheinLaden(b: AktuellerBenutzer, id: string) {
  const l = await db.lieferschein.findFirst({
    where: { id, ...sichtbar(b) },
    include: { dateien: { select: { id: true, name: true, typ: true, groesse: true } }, lieferant: true, projekt: { select: { id: true, nummer: true, titel: true } }, bestellung: { select: { id: true, nummer: true } }, eingangsrechnung: { select: { id: true, rechnungsnummer: true, status: true } }, erfasstVon: { select: { name: true } } },
  });
  if (!l) throw new FachFehler("Lieferschein nicht gefunden.", "NICHT_GEFUNDEN");
  return l;
}

export async function lieferscheinListe(b: AktuellerBenutzer, filter: { status?: string | null; projektId?: string | null }) {
  return db.lieferschein.findMany({
    where: { ...sichtbar(b), ...(filter.status === "ALLE" ? {} : { status: (filter.status as "OFFEN") ?? "OFFEN" }), ...(filter.projektId ? { projektId: filter.projektId } : {}) },
    include: { lieferant: true, projekt: { select: { nummer: true } }, eingangsrechnung: { select: { id: true, rechnungsnummer: true } }, erfasstVon: { select: { name: true } }, _count: { select: { dateien: true } } },
    orderBy: { datum: "desc" }, take: 300,
  });
}

export async function lieferscheinBearbeiten(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof LieferscheinEingabe>, neueDateien: Datei[] = []) {
  const l = await lieferscheinLaden(b, id);
  if (l.status !== "OFFEN") throw new FachFehler("Abgerechnete Lieferscheine lassen sich nicht mehr ändern.");
  const e = LieferscheinEingabe.parse(eingabe);
  await bezuege(l.firmaId, e);
  if (l.dateien.length + neueDateien.length > MAX_DATEIEN) throw new FachFehler(`Höchstens ${MAX_DATEIEN} Dateien je Lieferschein.`);
  await db.lieferschein.update({
    where: { id: l.id },
    data: {
      lieferantId: e.lieferantId || null, lieferantName: e.lieferantId ? null : leer(e.lieferantName), nummer: leer(e.nummer), datum: berlinZuUtc(e.datum, "12:00"),
      projektId: e.projektId || null, betrag: e.betrag ?? null, notiz: leer(e.notiz),
      ...(neueDateien.length ? { dateien: { create: dateienPruefen(neueDateien) } } : {}),
    },
  });
}

export async function lieferscheinStornieren(b: AktuellerBenutzer, id: string) {
  const l = await lieferscheinLaden(b, id);
  if (l.status !== "OFFEN") throw new FachFehler("Nur offene Lieferscheine lassen sich stornieren.");
  if (l.eingangsrechnung) throw new FachFehler("Der Lieferschein ist einer Rechnung zugeordnet. Bitte dort erst lösen.");
  await db.lieferschein.update({ where: { id: l.id }, data: { status: "STORNIERT" } });
}

export async function lieferscheinDatei(b: AktuellerBenutzer, dateiId: string) {
  const d = await db.lieferscheinDatei.findUnique({ where: { id: dateiId }, include: { lieferschein: { select: { firmaId: true, erfasstVonId: true } } } });
  if (!d) throw new FachFehler("Datei nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, d.lieferschein.firmaId);
  if (b.rolle === "KOLONNE" && d.lieferschein.erfasstVonId !== b.id) throw new FachFehler("Datei nicht gefunden.", "NICHT_GEFUNDEN");
  return d;
}

/** Offene Lieferscheine, die zu einer Rechnung passen könnten (gleicher Lieferant oder noch ohne Lieferant). */
export async function passendeLieferscheine(firmaId: string, rechnung: { id: string; lieferantId: string | null; lieferantName: string | null }) {
  return db.lieferschein.findMany({
    where: {
      firmaId, status: { not: "STORNIERT" },
      OR: [
        { eingangsrechnungId: rechnung.id },
        { status: "OFFEN", eingangsrechnungId: null, OR: [...(rechnung.lieferantId ? [{ lieferantId: rechnung.lieferantId }] : []), ...(rechnung.lieferantName ? [{ lieferantName: { equals: rechnung.lieferantName, mode: "insensitive" as const } }] : []), { lieferantId: null, lieferantName: null }] },
      ],
    },
    include: { projekt: { select: { nummer: true } }, _count: { select: { dateien: true } } },
    orderBy: { datum: "asc" },
  });
}

/** Lieferscheine einer Rechnung zuordnen (ersetzt die bisherige Zuordnung). */
export async function lieferscheineZuordnen(b: AktuellerBenutzer, rechnungId: string, ids: string[]) {
  rollePruefen(b);
  const r = await db.eingangsrechnung.findUnique({ where: { id: rechnungId }, select: { id: true, firmaId: true, status: true, lieferantId: true, lieferantName: true } });
  if (!r) throw new FachFehler("Rechnung nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, r.firmaId);
  if (r.status === "FREIGEGEBEN" || r.status === "BEZAHLT") throw new FachFehler("Bei freigegebenen Rechnungen lässt sich die Zuordnung nicht mehr ändern.");
  const erlaubt = new Set((await passendeLieferscheine(r.firmaId, r)).map((l) => l.id));
  const gewaehlt = ids.filter((i) => erlaubt.has(i));
  await db.$transaction([
    db.lieferschein.updateMany({ where: { eingangsrechnungId: r.id, id: { notIn: gewaehlt } }, data: { eingangsrechnungId: null } }),
    db.lieferschein.updateMany({ where: { id: { in: gewaehlt } }, data: { eingangsrechnungId: r.id, ...(r.lieferantId ? { lieferantId: r.lieferantId, lieferantName: null } : {}) } }),
  ]);
  return gewaehlt.length;
}


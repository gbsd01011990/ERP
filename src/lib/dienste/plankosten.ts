import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { planErgebnis } from "../rechnung/plankosten";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

/** Typische Kostengruppen eines GaLaBau-Betriebs als Startpunkt; Beträge trägt der Betrieb ein. */
const STANDARD_ZEILEN: [string, string][] = [
  ["Personal Verwaltung", "Gehälter Büro und Bauleitung inkl. Nebenkosten"],
  ["Personal Verwaltung", "Geschäftsführung (kalkulatorischer Unternehmerlohn)"],
  ["Fahrzeuge", "Pkw und Transporter, soweit nicht als Gerät verrechnet"],
  ["Gebäude", "Miete, Pacht Betriebshof"],
  ["Gebäude", "Strom, Wasser, Heizung"],
  ["Versicherungen", "Betriebshaftpflicht, Gebäude, Beiträge Berufsgenossenschaft (Verwaltung)"],
  ["Büro", "Software, Telefon, Porto, Büromaterial"],
  ["Beratung", "Steuerberatung, Rechtsberatung"],
  ["Werbung", "Website, Anzeigen, Fahrzeugbeschriftung"],
  ["Abschreibung", "Betriebs- und Geschäftsausstattung"],
  ["Sonstiges", "Weiterbildung, Kleinwerkzeug, Arbeitsschutz"],
];

export async function planAnlegen(b: AktuellerBenutzer, firmaId: string, jahr: number) {
  rollePruefen(b, ["ADMIN"]);
  firmaPruefen(b, firmaId);
  if (await db.kostenplan.findUnique({ where: { firmaId_jahr: { firmaId, jahr } } })) {
    throw new FachFehler(`Für ${jahr} gibt es in dieser Firma schon einen Plan.`);
  }
  // Vorjahr als Vorlage übernehmen, sonst Standardgruppen
  const vorjahr = await db.kostenplan.findFirst({ where: { firmaId, jahr: { lt: jahr } }, orderBy: { jahr: "desc" }, include: { zeilen: true } });
  if (vorjahr) {
    const { id: _i, createdAt: _c, updatedAt: _u, uebernommenAm: _ue, zeilen, ...rest } = vorjahr;
    return db.kostenplan.create({
      data: { ...rest, jahr, bezeichnung: `Plan ${jahr} (aus ${vorjahr.jahr})`, zeilen: { create: zeilen.map(({ id: _z, planId: _p, ...z }) => z) } },
    });
  }
  return db.kostenplan.create({
    data: {
      firmaId, jahr, bezeichnung: `Plan ${jahr}`,
      zeilen: { create: STANDARD_ZEILEN.map(([gruppe, bezeichnung], i) => ({ gruppe, bezeichnung, betragJahr: 0, reihenfolge: (i + 1) * 10 })) },
    },
  });
}

async function planLaden(b: AktuellerBenutzer, id: string) {
  rollePruefen(b, ["ADMIN"]);
  const p = await db.kostenplan.findUnique({ where: { id } });
  if (!p) throw new FachFehler("Plan nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, p.firmaId);
  return p;
}

const betrag = z.number().nonnegative();
export const PlanEingabe = z.object({
  bezeichnung: z.string().nullish(),
  mitarbeiter: betrag, bezahlteStundenJahr: betrag, produktivProzent: betrag.max(100),
  mittellohn: betrag, lohnnebenkostenProzent: betrag, materialEinsatzJahr: betrag, fremdEinsatzJahr: betrag,
  wagnisGewinnProzent: betrag,
});

export async function planSpeichern(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof PlanEingabe>) {
  await planLaden(b, id);
  return db.kostenplan.update({ where: { id }, data: PlanEingabe.parse(eingabe) });
}

export const ZeileEingabe = z.object({
  gruppe: z.string().trim().min(1),
  bezeichnung: z.string().trim().min(1),
  betragJahr: betrag,
  verteilung: z.enum(["LOHN", "MATERIAL", "FREMD"]).default("LOHN"),
});

export async function zeileSpeichern(b: AktuellerBenutzer, planId: string, zeileId: string | null, eingabe: z.input<typeof ZeileEingabe>) {
  await planLaden(b, planId);
  const e = ZeileEingabe.parse(eingabe);
  if (!zeileId) {
    const letzte = await db.kostenplanZeile.findFirst({ where: { planId }, orderBy: { reihenfolge: "desc" } });
    return db.kostenplanZeile.create({ data: { planId, reihenfolge: (letzte?.reihenfolge ?? 0) + 10, ...e } });
  }
  const z0 = await db.kostenplanZeile.findUnique({ where: { id: zeileId } });
  if (!z0 || z0.planId !== planId) throw new FachFehler("Zeile nicht gefunden.", "NICHT_GEFUNDEN");
  return db.kostenplanZeile.update({ where: { id: zeileId }, data: e });
}

export async function zeileLoeschen(b: AktuellerBenutzer, zeileId: string) {
  const z0 = await db.kostenplanZeile.findUnique({ where: { id: zeileId } });
  if (!z0) throw new FachFehler("Zeile nicht gefunden.", "NICHT_GEFUNDEN");
  await planLaden(b, z0.planId);
  await db.kostenplanZeile.delete({ where: { id: zeileId } });
  return z0;
}

/** Übernimmt Stundensatz und Zuschläge in die Firma. Gilt für neue Angebote; bestehende behalten ihre Sätze. */
export async function saetzeUebernehmen(b: AktuellerBenutzer, planId: string) {
  const p = await planLaden(b, planId);
  const zeilen = await db.kostenplanZeile.findMany({ where: { planId } });
  const r = planErgebnis(p, zeilen);
  if (!r.stundensatz) throw new FachFehler("Ohne produktive Stunden lässt sich kein Stundensatz bilden. Mitarbeiter und Stunden eintragen.");
  await db.$transaction([
    db.firma.update({ where: { id: p.firmaId }, data: { stundensatz: r.stundensatz, materialAufschlag: r.materialAufschlag, fremdAufschlag: r.fremdAufschlag } }),
    db.kostenplan.update({ where: { id: p.id }, data: { uebernommenAm: new Date() } }),
  ]);
  return r;
}

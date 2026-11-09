/**
 * Rechnungswesen: Rechnung, Abschlag (nach Aufmaß kumuliert oder nach Zahlungsplan),
 * Teilschluss-, Schluss-, Korrektur- und Stornorechnung.
 *
 * GoBD: Ein Entwurf hat keine Nummer und ist frei änderbar. festschreiben() vergibt
 * in einer Transaktion die nächste Nummer, friert Beträge, Anschrift und Berechnung
 * ein und speichert das PDF. Scheitert das PDF, rollt die Transaktion zurück und
 * die Nummer bleibt frei – der Nummernkreis bleibt lückenlos.
 */
import { Prisma, type RechnungsArt, type AbschlagsModus, type Kostenart } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteNummer } from "../nummern";
import { n, runden, einzelpreisAnteile, wirksamerEp, nummerieren } from "../kalkulation";
import { briefanrede, empfaengerZeilen } from "../vorlagen";
import { datum as datumText, kontaktName } from "../format";
import { gaebLesen, ozSchluessel } from "../gaeb";
import {
  rechnungBerechnen, aufmassMenge, aufmassZeileWert, kostenartAusKalkulation, beguenstigtJeEinheit,
  type Berechnung, type VorRechnung,
} from "../faktura/berechnung";
import { FormelFehler } from "../faktura/formel";
import { standardTexte, ART_TITEL } from "../faktura/texte";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

export const rechnungInclude = {
  firma: true,
  projekt: { include: { kontakt: { include: { adressen: true } } } },
  angebot: { select: { id: true, nummer: true, version: true, art: true, datum: true } },
  bezug: { select: { id: true, nummer: true, datum: true, art: true } },
  positionen: { orderBy: { reihenfolge: "asc" as const }, include: { aufmass: { orderBy: { reihenfolge: "asc" as const } } } },
  verrechnungen: { include: { vor: { select: { id: true, nummer: true, datum: true, art: true, abschlagNr: true } } } },
  erstelltVon: { select: { name: true } },
  festgeschriebenVon: { select: { name: true } },
} satisfies Prisma.RechnungInclude;

export type GeladeneRechnung = Prisma.RechnungGetPayload<{ include: typeof rechnungInclude }>;

const ohnePdf = { pdf: true } as const;

export async function rechnungLaden(b: AktuellerBenutzer, id: string) {
  const r = await db.rechnung.findUnique({ where: { id }, include: rechnungInclude, omit: ohnePdf });
  if (!r) throw new FachFehler("Rechnung nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, r.firmaId);
  return r as GeladeneRechnung;
}

async function entwurf(b: AktuellerBenutzer, id: string) {
  rollePruefen(b);
  const r = await rechnungLaden(b, id);
  if (r.status !== "ENTWURF") throw new FachFehler("Festgeschriebene Rechnungen lassen sich nicht ändern. Lege eine Rechnungskorrektur an oder storniere sie.");
  return r;
}

/** Live-Berechnung (Entwurf) oder eingefrorene Berechnung (festgeschrieben). */
export function berechnung(r: GeladeneRechnung): Berechnung {
  if (r.status !== "ENTWURF" && r.berechnung) return r.berechnung as unknown as Berechnung;
  return rechnungBerechnen(r.positionen, r, r.verrechnungen);
}

const vorWerte = (v: { netto: Prisma.Decimal; mwst: Prisma.Decimal; brutto: Prisma.Decimal; einbehalt: Prisma.Decimal; lohnBrutto: Prisma.Decimal }): VorRechnung => v;

// ------------------------------------------------------------------ Anlegen

export const NeueRechnung = z.object({
  projektId: z.string().min(1),
  art: z.enum(["RECHNUNG", "ABSCHLAG", "TEILSCHLUSS", "SCHLUSS", "KORREKTUR"]),
  angebotId: z.string().nullish(),
  modus: z.enum(["AUFMASS", "PLAN"]).nullish(),
  planProzent: z.number().positive().max(100).nullish(),
  bezugId: z.string().nullish(),
});

type PosDaten = Omit<Prisma.RechnungsPositionCreateManyInput, "rechnungId"> & { aufmass?: Omit<Prisma.RechnungsAufmassCreateManyInput, "positionId">[] };

/** Gleicher Auftrag: gleiches Angebot, sonst gleiches Projekt ohne Angebot. */
const auftragFilter = (projektId: string, angebotId: string | null | undefined) => ({ projektId, angebotId: angebotId ?? null });

export async function rechnungAnlegen(b: AktuellerBenutzer, eingabe: z.input<typeof NeueRechnung>) {
  rollePruefen(b);
  const e = NeueRechnung.parse(eingabe);
  const projekt = await db.projekt.findUnique({ where: { id: e.projektId }, include: { firma: true, kontakt: true } });
  if (!projekt) throw new FachFehler("Projekt nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, projekt.firmaId);
  const f = projekt.firma;

  const angebot = e.angebotId
    ? await db.angebot.findUnique({ where: { id: e.angebotId }, include: { positionen: { orderBy: { reihenfolge: "asc" } } } })
    : null;
  if (e.angebotId && (!angebot || angebot.projektId !== projekt.id)) throw new FachFehler("Das Angebot gehört nicht zu diesem Projekt.");
  if (e.art === "ABSCHLAG" && !e.modus) throw new FachFehler("Bitte wählen: Abschlag nach Aufmaß oder nach Zahlungsplan.");
  if (e.art === "ABSCHLAG" && e.modus === "PLAN" && (!angebot || !e.planProzent)) throw new FachFehler("Für einen Abschlag nach Zahlungsplan brauchst du ein Angebot und einen Prozentsatz.");

  const bezug = e.art === "KORREKTUR" && e.bezugId ? await db.rechnung.findUnique({ where: { id: e.bezugId }, omit: ohnePdf }) : null;
  if (e.art === "KORREKTUR") {
    if (!bezug || bezug.projektId !== projekt.id || bezug.status !== "FESTGESCHRIEBEN") throw new FachFehler("Bitte die festgeschriebene Rechnung wählen, die berichtigt wird.");
  }

  const auftrag = auftragFilter(projekt.id, angebot?.id ?? bezug?.angebotId);
  const frueher = await db.rechnung.findMany({
    where: { ...auftrag, status: "FESTGESCHRIEBEN" },
    orderBy: [{ datum: "asc" }, { festgeschriebenAm: "asc" }],
    include: { positionen: { orderBy: { reihenfolge: "asc" }, include: { aufmass: { orderBy: { reihenfolge: "asc" } } } }, verrechnetIn: { include: { rechnung: { select: { art: true, status: true } } } } },
    omit: ohnePdf,
  });
  const letzte = frueher[frueher.length - 1];
  const abschlagNr = e.art === "ABSCHLAG"
    ? (await db.rechnung.count({ where: { ...auftrag, art: "ABSCHLAG", status: { not: "STORNIERT" } } })) + 1
    : null;

  // Positionen
  let positionen: PosDaten[] = [];
  const saetze = angebot ? { stundensatz: angebot.stundensatz, materialAufschlag: angebot.materialAufschlag, fremdAufschlag: angebot.fremdAufschlag } : null;
  const ausAngebot = (mitMenge: boolean): PosDaten[] =>
    angebot && saetze
      ? angebot.positionen.filter((p) => !p.bedarf).map((p) => {
          const ep = p.art === "POSITION" ? wirksamerEp(p, saetze) : 0;
          const k = p.art === "POSITION" ? kostenartAusKalkulation(einzelpreisAnteile(p, saetze), ep) : { kostenart: "MATERIAL" as const, lohnEp: 0 };
          return {
            reihenfolge: p.reihenfolge, art: p.art, ebene: p.ebene, oz: p.oz, kurztext: p.kurztext, langtext: p.langtext,
            menge: p.art === "POSITION" && mitMenge ? p.menge : 0, einheit: p.einheit, einzelpreis: ep, ...k,
            auftragsMenge: p.art === "POSITION" ? p.menge : null, angebotsPositionId: p.id,
          };
        })
      : [];
  const ausRechnung = (r: (typeof frueher)[number]): PosDaten[] =>
    r.positionen.map((p) => ({
      reihenfolge: p.reihenfolge, art: p.art, ebene: p.ebene, oz: p.oz, kurztext: p.kurztext, langtext: p.langtext,
      menge: p.menge, einheit: p.einheit, einzelpreis: p.einzelpreis, kostenart: p.kostenart, lohnEp: p.lohnEp,
      auftragsMenge: p.auftragsMenge, angebotsPositionId: p.angebotsPositionId,
      aufmass: p.aufmass.map(({ id: _i, positionId: _p, ...z }) => z),
    }));
  const letzterAufmassStand = [...frueher].reverse().find((r) => r.art === "ABSCHLAG" && r.abschlagModus === "AUFMASS");

  if (e.art === "ABSCHLAG" && e.modus === "PLAN" && angebot && saetze) {
    const basis = ausAngebot(true).filter((p) => p.art === "POSITION");
    const gesamt = runden(basis.reduce((s, p) => s + runden(n(p.menge) * n(p.einzelpreis)), 0));
    const arbeit = runden(basis.reduce((s, p) => s + n(p.menge) * beguenstigtJeEinheit({ kostenart: p.kostenart as Kostenart, einzelpreis: p.einzelpreis, lohnEp: p.lohnEp }), 0));
    const q = (e.planProzent ?? 0) / 100;
    const prozent = String(e.planProzent).replace(".", ",");
    const grundlage = `Auftragssumme netto ${eurText(gesamt)}, davon Arbeits-, Maschinen- und Fahrtkosten ${eurText(arbeit)}.`;
    positionen = [
      { reihenfolge: 10, art: "POSITION", kurztext: `${prozent} % Abschlag auf Arbeits-, Maschinen- und Fahrtkosten`, langtext: grundlage, menge: 1, einheit: "psch", einzelpreis: runden(arbeit * q), kostenart: "LOHN", lohnEp: runden(arbeit * q) },
      { reihenfolge: 20, art: "POSITION", kurztext: `${prozent} % Abschlag auf Material und Fremdleistungen`, langtext: grundlage, menge: 1, einheit: "psch", einzelpreis: runden((gesamt - arbeit) * q), kostenart: "MATERIAL", lohnEp: 0 },
    ].filter((p) => n(p.einzelpreis) !== 0) as PosDaten[];
  } else if (e.art === "ABSCHLAG") {
    positionen = letzterAufmassStand ? ausRechnung(letzterAufmassStand) : ausAngebot(false);
  } else if (e.art === "TEILSCHLUSS" || e.art === "SCHLUSS") {
    positionen = letzterAufmassStand ? ausRechnung(letzterAufmassStand) : ausAngebot(true);
  } else if (e.art === "RECHNUNG") {
    positionen = ausAngebot(true);
  }

  // Verrechnung: was zieht diese Rechnung ab?
  const schonSchlussVerrechnet = (r: (typeof frueher)[number]) =>
    r.verrechnetIn.some((v) => (v.rechnung.art === "SCHLUSS" || v.rechnung.art === "TEILSCHLUSS") && v.rechnung.status === "FESTGESCHRIEBEN");
  const abzuziehen =
    e.art === "ABSCHLAG" && e.modus === "AUFMASS" ? frueher.filter((r) => r.art === "ABSCHLAG")
    : e.art === "SCHLUSS" ? frueher.filter((r) => (r.art === "ABSCHLAG" || r.art === "TEILSCHLUSS") && !schonSchlussVerrechnet(r))
    : [];

  const grundlage = angebot ? { art: angebot.art, nummer: angebot.version > 1 ? `${angebot.nummer}-${angebot.version}` : angebot.nummer, datum: datumText(angebot.datum) } : null;
  const texte = standardTexte(e.art, {
    grundlage, abschlagNr: abschlagNr ?? undefined, planProzent: e.modus === "PLAN" ? e.planProzent ?? undefined : undefined,
    bezug: bezug ? { nummer: bezug.nummer ?? "", datum: datumText(bezug.datum) } : undefined,
  });
  const vorlage = bezug ?? letzte;

  return db.$transaction(async (tx) => {
    const r = await tx.rechnung.create({
      data: {
        firmaId: f.id, projektId: projekt.id, angebotId: angebot?.id ?? bezug?.angebotId ?? null, bezugId: bezug?.id ?? null,
        art: e.art, abschlagNr, abschlagModus: e.art === "ABSCHLAG" ? (e.modus as AbschlagsModus) : null,
        planProzent: e.modus === "PLAN" ? e.planProzent : null,
        betreff: bezug?.betreff ?? (projekt.baustelleOrt
          ? `BV: ${[projekt.baustelleStrasse, projekt.baustelleOrt].filter(Boolean).join(", ")} – ${projekt.titel}`
          : projekt.titel),
        anrede: briefanrede(projekt.kontakt),
        einleitung: texte.einleitung, schlusstext: texte.schlusstext,
        kundenReferenz: vorlage?.kundenReferenz ?? projekt.kontakt.leitwegId ?? null,
        mwstSatz: vorlage?.mwstSatz ?? f.mwstSatz,
        steuerschuldUmkehr: vorlage?.steuerschuldUmkehr ?? false,
        s35a: vorlage?.s35a ?? projekt.kontakt.kategorie === "PRIVAT",
        zahlungszielTage: e.art === "ABSCHLAG" && e.modus === "PLAN" ? 7 : f.zahlungszielTage,
        skontoProzent: f.skontoProzent, skontoTage: f.skontoTage,
        einbehaltProzent: vorlage?.einbehaltProzent ?? 0,
        leistungVon: e.art === "KORREKTUR" ? bezug?.leistungVon : null,
        leistungBis: e.art === "KORREKTUR" ? bezug?.leistungBis : null,
        erstelltVonId: b.id,
      },
    });
    for (const p of positionen) {
      const { aufmass, ...daten } = p;
      await tx.rechnungsPosition.create({
        data: { ...daten, rechnungId: r.id, ...(aufmass?.length ? { aufmass: { createMany: { data: aufmass } } } : {}) },
      });
    }
    for (const v of abzuziehen) {
      await tx.verrechnung.create({ data: { rechnungId: r.id, vorId: v.id, netto: v.netto, mwst: v.mwst, brutto: v.brutto, einbehalt: v.einbehalt, lohnBrutto: v.lohnBrutto } });
    }
    await tx.logbuchEintrag.create({ data: { projektId: projekt.id, benutzerId: b.id, art: "SYSTEM", text: `${ART_TITEL[e.art]} (Entwurf) angelegt` } });
    return r;
  });
}

const eurText = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

// ------------------------------------------------------------------ Bearbeiten

const tag = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal(""));
export const KopfEingabe = z.object({
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leistungVon: tag,
  leistungBis: tag,
  betreff: z.string().trim().min(1, "Betreff fehlt"),
  anrede: z.string().nullish(),
  einleitung: z.string().nullish(),
  schlusstext: z.string().nullish(),
  kundenReferenz: z.string().nullish(),
  mwstSatz: z.number().min(0).max(100),
  steuerschuldUmkehr: z.boolean(),
  s35a: z.boolean(),
  zahlungszielTage: z.number().int().min(0).max(365),
  skontoProzent: z.number().min(0).max(100),
  skontoTage: z.number().int().min(0).max(365),
  einbehaltProzent: z.number().min(0).max(100),
  aufmassAnhang: z.boolean(),
});

const alsTag = (s: string | null | undefined) => (s ? new Date(`${s}T12:00:00Z`) : null);

export async function kopfSpeichern(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof KopfEingabe>) {
  const r = await entwurf(b, id);
  const e = KopfEingabe.parse(eingabe);
  const von = alsTag(e.leistungVon), bis = alsTag(e.leistungBis);
  if (von && bis && von > bis) throw new FachFehler("Der Leistungszeitraum endet vor seinem Beginn.");
  await db.rechnung.update({
    where: { id: r.id },
    data: { ...e, datum: alsTag(e.datum)!, leistungVon: von, leistungBis: bis, anrede: e.anrede || null, einleitung: e.einleitung || null, schlusstext: e.schlusstext || null, kundenReferenz: e.kundenReferenz || null },
  });
}

export const PositionEingabe = z.object({
  art: z.enum(["GRUPPE", "POSITION", "TEXT"]),
  oz: z.string().nullish(),
  kurztext: z.string().trim().min(1, "Kurztext fehlt"),
  langtext: z.string().nullish(),
  menge: z.number(),
  einheit: z.string().trim().min(1).default("Stk."),
  einzelpreis: z.number(),
  kostenart: z.enum(["LOHN", "MASCHINE", "FAHRT", "MATERIAL", "GEMISCHT"]),
  lohnEp: z.number().default(0),
});

export async function positionHinzufuegen(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof PositionEingabe>) {
  const r = await entwurf(b, id);
  const e = PositionEingabe.parse(eingabe);
  const letzte = r.positionen[r.positionen.length - 1];
  await db.rechnungsPosition.create({ data: { ...e, oz: e.oz || null, langtext: e.langtext || null, rechnungId: r.id, reihenfolge: (letzte?.reihenfolge ?? 0) + 10 } });
}

export async function positionAendern(b: AktuellerBenutzer, positionId: string, eingabe: z.input<typeof PositionEingabe>) {
  const p = await db.rechnungsPosition.findUnique({ where: { id: positionId }, include: { aufmass: true } });
  if (!p) throw new FachFehler("Position nicht gefunden.", "NICHT_GEFUNDEN");
  await entwurf(b, p.rechnungId);
  const e = PositionEingabe.parse(eingabe);
  // Mit Mengennachweis ergibt sich die Menge aus dem Aufmaß
  const menge = p.aufmass.length ? p.menge : e.menge;
  await db.rechnungsPosition.update({ where: { id: p.id }, data: { ...e, menge, oz: e.oz || null, langtext: e.langtext || null } });
}

export async function positionLoeschen(b: AktuellerBenutzer, positionId: string) {
  const p = await db.rechnungsPosition.findUnique({ where: { id: positionId } });
  if (!p) return;
  await entwurf(b, p.rechnungId);
  await db.rechnungsPosition.delete({ where: { id: p.id } });
}

export const AufmassEingabe = z.object({
  datum: tag,
  text: z.string().nullish(),
  formel: z.string().nullish(),
  anzahl: z.number().nullish(),
  laenge: z.number().nullish(),
  breite: z.number().nullish(),
  hoehe: z.number().nullish(),
  abzug: z.boolean().default(false),
  reb: z.string().nullish(),
});

async function mengeNeu(tx: Prisma.TransactionClient, positionId: string) {
  const zeilen = await tx.rechnungsAufmass.findMany({ where: { positionId } });
  await tx.rechnungsPosition.update({ where: { id: positionId }, data: { menge: aufmassMenge(zeilen) } });
}

export async function aufmassHinzufuegen(b: AktuellerBenutzer, positionId: string, eingabe: z.input<typeof AufmassEingabe>) {
  const p = await db.rechnungsPosition.findUnique({ where: { id: positionId }, include: { aufmass: true } });
  if (!p || p.art !== "POSITION") throw new FachFehler("Position nicht gefunden.", "NICHT_GEFUNDEN");
  await entwurf(b, p.rechnungId);
  const e = AufmassEingabe.parse(eingabe);
  if (!e.formel?.trim() && [e.anzahl, e.laenge, e.breite, e.hoehe].every((v) => v == null)) throw new FachFehler("Bitte eine Formel oder mindestens einen Faktor eingeben.");
  try {
    aufmassZeileWert({ ...e, formel: e.formel ?? null, anzahl: e.anzahl ?? null, laenge: e.laenge ?? null, breite: e.breite ?? null, hoehe: e.hoehe ?? null });
  } catch (f) {
    if (f instanceof FormelFehler) throw new FachFehler(f.message);
    throw f;
  }
  const reihenfolge = Math.max(0, ...p.aufmass.map((z) => z.reihenfolge)) + 10;
  await db.$transaction(async (tx) => {
    // Erste Aufmaßzeile: bisherige Handmenge geht nicht verloren, sie steht dann als eigene Zeile da
    if (p.aufmass.length === 0 && n(p.menge) !== 0) {
      await tx.rechnungsAufmass.create({ data: { positionId: p.id, reihenfolge: 5, text: "Menge vor Mengennachweis", anzahl: p.menge } });
    }
    await tx.rechnungsAufmass.create({
      data: { positionId: p.id, reihenfolge, datum: alsTag(e.datum) ?? new Date(), text: e.text || null, formel: e.formel?.trim() || null, anzahl: e.anzahl, laenge: e.laenge, breite: e.breite, hoehe: e.hoehe, abzug: e.abzug, reb: e.reb || null },
    });
    await mengeNeu(tx, p.id);
  });
}

export async function aufmassLoeschen(b: AktuellerBenutzer, zeileId: string) {
  const z = await db.rechnungsAufmass.findUnique({ where: { id: zeileId }, include: { position: true } });
  if (!z) return;
  await entwurf(b, z.position.rechnungId);
  await db.$transaction(async (tx) => {
    await tx.rechnungsAufmass.delete({ where: { id: z.id } });
    await mengeNeu(tx, z.positionId);
  });
}

/** Rechnungen, die diese Rechnung abziehen kann: festgeschriebene Abschläge und Teilschlussrechnungen im Projekt. */
export async function verrechenbare(r: GeladeneRechnung) {
  return db.rechnung.findMany({
    where: { projektId: r.projektId, status: "FESTGESCHRIEBEN", art: { in: ["ABSCHLAG", "TEILSCHLUSS"] }, id: { not: r.id } },
    orderBy: { datum: "asc" },
    select: { id: true, nummer: true, datum: true, art: true, abschlagNr: true, brutto: true },
  });
}

export async function verrechnungenSetzen(b: AktuellerBenutzer, id: string, vorIds: string[]) {
  const r = await entwurf(b, id);
  if (!["ABSCHLAG", "TEILSCHLUSS", "SCHLUSS"].includes(r.art)) throw new FachFehler("Nur Abschlags-, Teilschluss- und Schlussrechnungen ziehen frühere Rechnungen ab.");
  const erlaubt = new Map((await verrechenbare(r)).map((v) => [v.id, v]));
  const vor = await db.rechnung.findMany({ where: { id: { in: vorIds.filter((v) => erlaubt.has(v)) } }, omit: ohnePdf });
  await db.$transaction(async (tx) => {
    await tx.verrechnung.deleteMany({ where: { rechnungId: r.id } });
    for (const v of vor) {
      await tx.verrechnung.create({ data: { rechnungId: r.id, vorId: v.id, netto: v.netto, mwst: v.mwst, brutto: v.brutto, einbehalt: v.einbehalt, lohnBrutto: v.lohnBrutto } });
    }
  });
}

/** Mengen aus GAEB X31 (Mengenermittlung) als Aufmaßzeilen übernehmen; Zuordnung über die Ordnungszahl. */
export async function mengenAusX31(b: AktuellerBenutzer, id: string, name: string, daten: Buffer) {
  const r = await entwurf(b, id);
  const g = await gaebLesen(name, daten);
  if (!g.mengen?.length) throw new FachFehler("Die Datei enthält keine Mengen (erwartet: GAEB X31).");
  const nachOz = new Map(nummerieren(r.positionen).filter((p) => p.art === "POSITION").map((p) => [ozSchluessel(p.posNr), p]));
  const unbekannt: string[] = [];
  let uebernommen = 0;
  await db.$transaction(async (tx) => {
    for (const m of g.mengen!) {
      const p = nachOz.get(ozSchluessel(m.oz));
      if (!p || m.menge == null) { unbekannt.push(m.oz); continue; }
      const max = Math.max(0, ...p.aufmass.map((z) => z.reihenfolge));
      await tx.rechnungsAufmass.create({
        data: { positionId: p.id, reihenfolge: max + 10, datum: new Date(), text: `GAEB X31: ${name}`, anzahl: m.menge, reb: m.zeilen.join("\n") || null },
      });
      await mengeNeu(tx, p.id);
      uebernommen++;
    }
  });
  return { uebernommen, unbekannt };
}

export async function entwurfLoeschen(b: AktuellerBenutzer, id: string) {
  const r = await entwurf(b, id);
  await db.rechnung.delete({ where: { id: r.id } });
  return r;
}

// ------------------------------------------------------------------ Festschreiben

export type Empfaenger = {
  zeilen: string[]; kundennummer: string; verbraucher: boolean;
  // strukturiert für die E-Rechnung (ab Einführung der E-Rechnung im Abbild enthalten)
  name?: string; strasse?: string | null; plz?: string | null; ort?: string | null; land?: string;
  email?: string | null; ustId?: string | null; kontaktperson?: string | null;
};

export function empfaengerAus(r: GeladeneRechnung): Empfaenger {
  if (r.status !== "ENTWURF" && r.empfaenger) return r.empfaenger as Empfaenger;
  const k = r.projekt.kontakt;
  const a = k.adressen.find((x) => x.art === "RECHNUNG") ?? k.adressen.find((x) => x.art === "HAUPT") ?? k.adressen[0];
  const person = [k.vorname, k.nachname].filter(Boolean).join(" ");
  return {
    zeilen: empfaengerZeilen(r.firma.kuerzel, k, a ?? undefined), kundennummer: k.nummer ?? "", verbraucher: k.kategorie === "PRIVAT",
    name: k.firmenname ?? (person || kontaktName(k)), strasse: a?.strasse ?? null, plz: a?.plz ?? null, ort: a?.ort ?? null, land: a?.land ?? "DE",
    email: k.email ?? null, ustId: k.ustId ?? null, kontaktperson: k.firmenname && person ? person : null,
  };
}

/** Prüfliste vor dem Festschreiben (§ 14 UStG, Plausibilität). Leere Liste = alles in Ordnung. */
export function pruefen(r: GeladeneRechnung, be: Berechnung) {
  const m: string[] = [];
  const emp = empfaengerAus(r);
  if (emp.zeilen.length < 3) m.push("Die Anschrift des Kunden ist unvollständig (Straße, PLZ und Ort).");
  if (!r.positionen.some((p) => p.art === "POSITION")) m.push("Die Rechnung hat keine Positionen.");
  const anzahlung = r.art === "ABSCHLAG" && !r.leistungVon && !r.leistungBis;
  if (!anzahlung && !r.leistungVon && !r.leistungBis && r.art !== "STORNO") m.push("Leistungszeitpunkt oder -zeitraum fehlt.");
  for (const v of r.verrechnungen) if (!v.vor.nummer) m.push("Eine verrechnete Rechnung ist nicht festgeschrieben.");
  if (r.art === "KORREKTUR" && !r.bezugId) m.push("Die Rechnungskorrektur braucht die berichtigte Rechnung.");
  if (r.art !== "KORREKTUR" && be.brutto < 0) m.push("Der Rechnungsbetrag ist negativ. Prüfe die Abzüge oder lege eine Rechnungskorrektur an.");
  return m;
}

/** Erzeugt PDF und E-Rechnung (wird von außen gereicht, damit dieser Dienst ohne Python testbar bleibt). */
export type Beleg = { pdf: Buffer; xml: string | null; xrechnung: string | null; hinweis: string | null };
export type PdfBauer = (r: GeladeneRechnung) => Promise<Beleg>;

export async function festschreiben(b: AktuellerBenutzer, id: string, pdfBauen: PdfBauer) {
  const r = await entwurf(b, id);
  // Verrechnungsbeträge frisch aus den Vorrechnungen ziehen; stornierte Vorrechnungen blockieren
  const vor = await db.rechnung.findMany({ where: { id: { in: r.verrechnungen.map((v) => v.vorId) } }, omit: ohnePdf });
  const storniert = vor.filter((v) => v.status !== "FESTGESCHRIEBEN");
  if (storniert.length) throw new FachFehler(`Verrechnete Rechnung ${storniert.map((v) => v.nummer).join(", ")} ist storniert. Nimm sie aus den Abzügen.`);
  const vorrechnungen = vor.map(vorWerte);
  const be = rechnungBerechnen(r.positionen, r, vorrechnungen);
  const maengel = pruefen(r, be);
  if (maengel.length) throw new FachFehler(`Festschreiben nicht möglich: ${maengel.join(" ")}`);

  return db.$transaction(async (tx) => {
    for (const v of vor) {
      await tx.verrechnung.updateMany({ where: { rechnungId: r.id, vorId: v.id }, data: { netto: v.netto, mwst: v.mwst, brutto: v.brutto, einbehalt: v.einbehalt, lohnBrutto: v.lohnBrutto } });
    }
    const nummer = await naechsteNummer(tx, r.firmaId, "RECHNUNG", r.datum);
    const vergeben = await tx.rechnung.findFirst({ where: { firmaId: r.firmaId, nummer } });
    if (vergeben) throw new FachFehler(`Die Rechnungsnummer ${nummer} ist schon vergeben. Stelle den Nummernkreis unter Einstellungen → Nummernkreise richtig.`);
    const jetzt = new Date();
    await tx.rechnung.update({
      where: { id: r.id },
      data: {
        nummer, status: "FESTGESCHRIEBEN", festgeschriebenAm: jetzt, festgeschriebenVonId: b.id,
        netto: be.netto, mwst: be.mwst, brutto: be.brutto, einbehalt: be.einbehalt, zahlbetrag: be.zahlbetrag, lohnBrutto: be.lohnBrutto,
        berechnung: be as unknown as Prisma.InputJsonValue, empfaenger: empfaengerAus(r) as unknown as Prisma.InputJsonValue,
      },
    });
    const fertig = (await tx.rechnung.findUniqueOrThrow({ where: { id: r.id }, include: rechnungInclude, omit: ohnePdf })) as GeladeneRechnung;
    const beleg = await pdfBauen(fertig);
    await tx.rechnung.update({ where: { id: r.id }, data: { pdf: new Uint8Array(beleg.pdf), xml: beleg.xml, xrechnung: beleg.xrechnung, eHinweis: beleg.hinweis } });
    await tx.logbuchEintrag.create({ data: { projektId: r.projektId, benutzerId: b.id, art: "SYSTEM", text: `${ART_TITEL[r.art]} ${nummer} festgeschrieben (${eurText(be.brutto)} brutto)` } });
    return { nummer };
  }, { timeout: 60_000 });
}

/** Zahlen einer Berechnung umdrehen (für die Stornorechnung). */
function negieren<T>(x: T): T {
  if (typeof x === "number") return (x === 0 ? 0 : -x) as T;
  if (Array.isArray(x)) return x.map(negieren) as T;
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === "mwstSatz" ? v : negieren(v)])) as T;
  return x;
}

/**
 * Storno: neue Rechnung mit eigener Nummer und umgekehrten Beträgen, die Original-
 * rechnung wird STORNIERT. Eine Rechnung, die schon in einer späteren Rechnung
 * abgezogen wurde, lässt sich erst stornieren, wenn die spätere storniert ist.
 */
export async function stornieren(b: AktuellerBenutzer, id: string, pdfBauen: PdfBauer) {
  rollePruefen(b);
  const r = await rechnungLaden(b, id);
  if (r.status !== "FESTGESCHRIEBEN") throw new FachFehler("Nur festgeschriebene Rechnungen lassen sich stornieren.");
  if (r.art === "STORNO") throw new FachFehler("Eine Stornorechnung lässt sich nicht stornieren.");
  const spaeter = await db.verrechnung.findMany({ where: { vorId: r.id, rechnung: { status: "FESTGESCHRIEBEN", art: { not: "STORNO" } } }, include: { rechnung: { select: { nummer: true } } } });
  if (spaeter.length) throw new FachFehler(`Rechnung ${r.nummer} ist in ${spaeter.map((s) => s.rechnung.nummer).join(", ")} abgezogen. Storniere zuerst diese.`);
  const be = negieren(berechnung(r));

  return db.$transaction(async (tx) => {
    const nummer = await naechsteNummer(tx, r.firmaId, "RECHNUNG");
    const jetzt = new Date();
    const s = await tx.rechnung.create({
      data: {
        firmaId: r.firmaId, projektId: r.projektId, angebotId: r.angebotId, bezugId: r.id, art: "STORNO", status: "FESTGESCHRIEBEN", nummer,
        datum: jetzt, leistungVon: r.leistungVon, leistungBis: r.leistungBis, betreff: r.betreff, anrede: r.anrede,
        ...standardTexte("STORNO", { grundlage: null, bezug: { nummer: r.nummer ?? "", datum: datumText(r.datum) } }),
        kundenReferenz: r.kundenReferenz, mwstSatz: r.mwstSatz, steuerschuldUmkehr: r.steuerschuldUmkehr, s35a: r.s35a,
        zahlungszielTage: 0, einbehaltProzent: r.einbehaltProzent, aufmassAnhang: false,
        netto: be.netto, mwst: be.mwst, brutto: be.brutto, einbehalt: be.einbehalt, zahlbetrag: be.zahlbetrag, lohnBrutto: be.lohnBrutto,
        berechnung: be as unknown as Prisma.InputJsonValue, empfaenger: r.empfaenger ?? Prisma.JsonNull,
        festgeschriebenAm: jetzt, festgeschriebenVonId: b.id, erstelltVonId: b.id,
        positionen: {
          create: r.positionen.map((p) => ({
            reihenfolge: p.reihenfolge, art: p.art, ebene: p.ebene, oz: p.oz, kurztext: p.kurztext, langtext: p.langtext,
            menge: p.art === "POSITION" ? -n(p.menge) : 0, einheit: p.einheit, einzelpreis: p.einzelpreis, kostenart: p.kostenart, lohnEp: p.lohnEp,
          })),
        },
        verrechnungen: {
          create: r.verrechnungen.map((v) => ({ vorId: v.vorId, netto: -n(v.netto), mwst: -n(v.mwst), brutto: -n(v.brutto), einbehalt: -n(v.einbehalt), lohnBrutto: -n(v.lohnBrutto) })),
        },
      },
    });
    await tx.rechnung.update({ where: { id: r.id }, data: { status: "STORNIERT" } });
    const fertig = (await tx.rechnung.findUniqueOrThrow({ where: { id: s.id }, include: rechnungInclude, omit: ohnePdf })) as GeladeneRechnung;
    const beleg = await pdfBauen(fertig);
    await tx.rechnung.update({ where: { id: s.id }, data: { pdf: new Uint8Array(beleg.pdf), xml: beleg.xml, xrechnung: beleg.xrechnung, eHinweis: beleg.hinweis } });
    await tx.logbuchEintrag.create({ data: { projektId: r.projektId, benutzerId: b.id, art: "SYSTEM", text: `Rechnung ${r.nummer} storniert durch ${nummer}` } });
    return s;
  }, { timeout: 60_000 });
}

export async function gespeichertesPdf(b: AktuellerBenutzer, id: string) {
  const r = await db.rechnung.findUnique({ where: { id }, select: { firmaId: true, pdf: true, nummer: true, art: true } });
  if (!r) throw new FachFehler("Rechnung nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, r.firmaId);
  return r;
}

export { type RechnungsArt };

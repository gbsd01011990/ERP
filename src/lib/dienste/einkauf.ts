/**
 * Einkauf: Bestellung → Wareneingang → Eingangsrechnung → Prüfung → Freigabe → Zahlung.
 *
 * Wer darf was:
 * - Kolonnen legen Bestellanforderungen an (Entwurf), etwa von der Baustelle.
 * - Das Büro bestellt bis zur Wertgrenze (Einstellungen → Buchhaltung), darüber ein Admin.
 * - Rechnungen prüft das ERP selbst (formal, rechnerisch, gegen Bestellung und Lieferung).
 *   Freigeben darf das Büro bis zur Freigabegrenze und nur ohne Fehler; Fehler übergehen
 *   oder höhere Beträge freigeben darf nur ein Admin, mit Begründung.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { Prisma, Kostenart2 } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteNummer } from "../nummern";
import { n, runden, einzelpreisAnteile } from "../kalkulation";
import { berlinTag, berlinZuUtc } from "../zeit";
import { datum as datumText, kontaktName } from "../format";
import { buchhaltungAus } from "../faktura/op";
import { pruefen, type PruefEingabe, type Pruefergebnis } from "../einkauf/pruefung";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";
import { buchen } from "./lager";

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());
const tag = (s: string) => berlinZuUtc(s, "12:00");

// ================================================================== Bestellungen

export const bestellungInclude = {
  lieferant: { include: { adressen: true } },
  projekt: { select: { id: true, nummer: true, titel: true, baustelleStrasse: true, baustellePlz: true, baustelleOrt: true } },
  lager: true,
  positionen: { orderBy: { reihenfolge: "asc" as const }, include: { artikel: { select: { id: true, nummer: true, bezeichnung: true } } } },
  wareneingaenge: { orderBy: { datum: "asc" as const }, include: { positionen: true, benutzer: { select: { name: true } } } },
  rechnungen: { select: { id: true, rechnungsnummer: true, status: true, brutto: true, datum: true } },
  erstelltVon: { select: { name: true } },
  bestelltVon: { select: { name: true } },
  firma: true,
} satisfies Prisma.BestellungInclude;

export type GeladeneBestellung = Prisma.BestellungGetPayload<{ include: typeof bestellungInclude }>;

export async function bestellungLaden(b: AktuellerBenutzer, id: string) {
  const x = await db.bestellung.findUnique({ where: { id }, include: bestellungInclude });
  if (!x) throw new FachFehler("Bestellung nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, x.firmaId);
  return x;
}

async function entwurf(b: AktuellerBenutzer, id: string) {
  rollePruefen(b, ["ADMIN", "BUERO", "KOLONNE"]);
  const x = await bestellungLaden(b, id);
  if (x.status !== "ENTWURF") throw new FachFehler("Nur Entwürfe lassen sich ändern.");
  return x;
}

async function nettoNeu(tx: Prisma.TransactionClient, id: string) {
  const p = await tx.bestellPosition.findMany({ where: { bestellungId: id } });
  await tx.bestellung.update({ where: { id }, data: { netto: runden(p.reduce((s, x) => s + n(x.menge) * n(x.preis), 0)) } });
}

export const PosEingabe = z.object({
  artikelId: z.string().nullish(),
  artNr: z.string().nullish(),
  text: z.string().trim().min(1, "Bezeichnung fehlt."),
  menge: z.number().positive("Menge muss größer als 0 sein."),
  einheit: z.string().trim().min(1).default("Stk."),
  preis: z.number().min(0).default(0),
});

export const BestellungEingabe = z.object({
  lieferantId: z.string().nullish(),
  projektId: z.string().nullish(),
  lagerId: z.string().nullish(),
  betreff: z.string().trim().min(1, "Betreff fehlt."),
  lieferadresse: z.string().nullish(),
  liefertermin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  notiz: z.string().nullish(),
});

async function bezuegePruefen(firmaId: string, e: { lieferantId?: string | null; projektId?: string | null; lagerId?: string | null }) {
  if (e.lieferantId && !(await db.kontakt.findFirst({ where: { id: e.lieferantId, geloescht: false } }))) throw new FachFehler("Lieferant nicht gefunden.");
  if (e.projektId && !(await db.projekt.findFirst({ where: { id: e.projektId, firmaId } }))) throw new FachFehler("Projekt nicht gefunden.");
  if (e.lagerId && !(await db.lager.findFirst({ where: { id: e.lagerId, firmaId } }))) throw new FachFehler("Lager nicht gefunden.");
}

export async function bestellungAnlegen(b: AktuellerBenutzer, eingabe: z.input<typeof BestellungEingabe>, positionen: z.input<typeof PosEingabe>[] = []) {
  rollePruefen(b, ["ADMIN", "BUERO", "KOLONNE"]);
  const e = BestellungEingabe.parse(eingabe);
  await bezuegePruefen(b.mandant.id, e);
  const pos = positionen.map((p) => PosEingabe.parse(p));
  const projekt = e.projektId ? await db.projekt.findUnique({ where: { id: e.projektId } }) : null;
  const adresse = e.lieferadresse ?? (projekt && !e.lagerId ? [projekt.baustelleStrasse, [projekt.baustellePlz, projekt.baustelleOrt].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null : null);
  return db.$transaction(async (tx) => {
    const x = await tx.bestellung.create({
      data: {
        firmaId: b.mandant.id, lieferantId: e.lieferantId || null, projektId: e.projektId || null, lagerId: e.lagerId || null,
        betreff: e.betreff, lieferadresse: leer(adresse), liefertermin: e.liefertermin ? tag(e.liefertermin) : null, notiz: leer(e.notiz), erstelltVonId: b.id,
        positionen: { create: pos.map((p, i) => ({ ...p, artikelId: p.artikelId || null, artNr: leer(p.artNr), reihenfolge: (i + 1) * 10 })) },
      },
    });
    await nettoNeu(tx, x.id);
    if (x.projektId) await tx.logbuchEintrag.create({ data: { projektId: x.projektId, benutzerId: b.id, art: "SYSTEM", text: `Bestellanforderung „${x.betreff}“ angelegt` } });
    return x;
  });
}

export async function bestellungKopf(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof BestellungEingabe>) {
  const x = await entwurf(b, id);
  const e = BestellungEingabe.parse(eingabe);
  await bezuegePruefen(x.firmaId, e);
  await db.bestellung.update({
    where: { id: x.id },
    data: { lieferantId: e.lieferantId || null, projektId: e.projektId || null, lagerId: e.lagerId || null, betreff: e.betreff, lieferadresse: leer(e.lieferadresse), liefertermin: e.liefertermin ? tag(e.liefertermin) : null, notiz: leer(e.notiz) },
  });
}

export async function positionHinzufuegen(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof PosEingabe>) {
  const x = await entwurf(b, id);
  const p = PosEingabe.parse(eingabe);
  if (p.artikelId) {
    const a = await db.artikel.findUnique({ where: { id: p.artikelId } });
    if (!a || a.firmaId !== x.firmaId) throw new FachFehler("Artikel nicht gefunden.");
  }
  await db.$transaction(async (tx) => {
    await tx.bestellPosition.create({ data: { ...p, artikelId: p.artikelId || null, artNr: leer(p.artNr), bestellungId: x.id, reihenfolge: (x.positionen.at(-1)?.reihenfolge ?? 0) + 10 } });
    await nettoNeu(tx, x.id);
  });
}

export async function positionAendern(b: AktuellerBenutzer, posId: string, eingabe: z.input<typeof PosEingabe> | null) {
  const p = await db.bestellPosition.findUnique({ where: { id: posId } });
  if (!p) throw new FachFehler("Position nicht gefunden.");
  const x = await entwurf(b, p.bestellungId);
  await db.$transaction(async (tx) => {
    if (eingabe === null) await tx.bestellPosition.delete({ where: { id: p.id } });
    else { const e = PosEingabe.parse(eingabe); await tx.bestellPosition.update({ where: { id: p.id }, data: { ...e, artikelId: e.artikelId || null, artNr: leer(e.artNr) } }); }
    await nettoNeu(tx, x.id);
  });
}

/** Material und Fremdleistungen aus dem Angebot bzw. der AB als Bestellanforderung übernehmen. */
export async function bestellungAusAngebot(b: AktuellerBenutzer, angebotId: string, art: "MATERIAL" | "FREMD") {
  rollePruefen(b);
  const a = await db.angebot.findUnique({ where: { id: angebotId }, include: { positionen: { orderBy: { reihenfolge: "asc" } }, projekt: true } });
  if (!a) throw new FachFehler("Angebot nicht gefunden.");
  firmaPruefen(b, a.firmaId);
  const saetze = { stundensatz: a.stundensatz, materialAufschlag: 0, fremdAufschlag: 0 };
  const pos = a.positionen
    .filter((p) => p.art === "POSITION" && !p.bedarf && n(art === "MATERIAL" ? p.materialEk : p.fremdEk) > 0)
    .map((p) => ({ text: p.kurztext, menge: n(p.menge), einheit: p.einheit, preis: art === "MATERIAL" ? einzelpreisAnteile(p, saetze).material : einzelpreisAnteile(p, saetze).fremd }));
  if (!pos.length) throw new FachFehler(art === "MATERIAL" ? "Das Angebot enthält kein kalkuliertes Material (Material-EK)." : "Das Angebot enthält keine kalkulierten Fremdleistungen (Fremd-EK).");
  return bestellungAnlegen(b, { projektId: a.projektId, betreff: `${art === "MATERIAL" ? "Material" : "Fremdleistung"} für ${a.projekt.nummer} ${a.projekt.titel}` }, pos);
}

/** Artikel unter Mindestbestand (alle Lager zusammen). */
export async function bestellvorschlag(b: AktuellerBenutzer) {
  rollePruefen(b);
  const artikel = await db.artikel.findMany({ where: { firmaId: b.mandant.id, aktiv: true, mindestbestand: { not: null } }, include: { bestaende: true }, orderBy: { nummer: "asc" } });
  // Schon bestellte, noch nicht gelieferte Mengen zählen mit
  const offen = await db.bestellPosition.findMany({ where: { artikelId: { in: artikel.map((a) => a.id) }, bestellung: { status: { in: ["ENTWURF", "BESTELLT", "TEILGELIEFERT"] } } } });
  return artikel.map((a) => {
    const bestand = a.bestaende.reduce((s, x) => s + n(x.menge), 0);
    const unterwegs = offen.filter((o) => o.artikelId === a.id).reduce((s, o) => s + n(o.menge) - n(o.geliefert), 0);
    const fehlt = n(a.mindestbestand) - bestand - unterwegs;
    return { a, bestand, unterwegs, vorschlag: Math.max(0, Math.ceil(fehlt * 2)) };
  }).filter((x) => x.vorschlag > 0);
}

export async function bestellungAusVorschlag(b: AktuellerBenutzer, lagerId: string, mengen: Record<string, number>) {
  rollePruefen(b);
  const artikel = await db.artikel.findMany({ where: { id: { in: Object.keys(mengen) }, firmaId: b.mandant.id } });
  const pos = artikel.filter((a) => mengen[a.id] > 0).map((a) => ({ artikelId: a.id, text: `${a.nummer} ${a.bezeichnung}`, menge: mengen[a.id], einheit: a.einheit, preis: n(a.letzterEk ?? a.durchschnittEk) }));
  if (!pos.length) throw new FachFehler("Bitte mindestens eine Menge eintragen.");
  return bestellungAnlegen(b, { lagerId, betreff: "Lagerauffüllung" }, pos);
}

/** Bestellung auslösen: Nummer vergeben, Wertgrenze prüfen. Den Versand übernimmt E-Mail oder PDF. */
export async function bestellen(b: AktuellerBenutzer, id: string) {
  rollePruefen(b, ["ADMIN", "BUERO"]);
  const x = await bestellungLaden(b, id);
  if (x.status !== "ENTWURF") throw new FachFehler("Diese Bestellung ist schon ausgelöst.");
  if (!x.lieferantId) throw new FachFehler("Bitte zuerst den Lieferanten wählen.");
  if (!x.positionen.length) throw new FachFehler("Die Bestellung hat keine Positionen.");
  const bh = buchhaltungAus(x.firma.buchhaltung);
  if (b.rolle !== "ADMIN" && n(x.netto) > bh.bestellLimitBuero) {
    throw new FachFehler(`Bestellungen über ${bh.bestellLimitBuero.toLocaleString("de-DE")} € netto löst ein Admin aus.`);
  }
  return db.$transaction(async (tx) => {
    const nummer = await naechsteNummer(tx, x.firmaId, "BESTELLUNG");
    const neu = await tx.bestellung.update({ where: { id: x.id }, data: { nummer, status: "BESTELLT", bestelltAm: new Date(), bestelltVonId: b.id } });
    if (x.projektId) await tx.logbuchEintrag.create({ data: { projektId: x.projektId, benutzerId: b.id, art: "SYSTEM", text: `Bestellung ${nummer} bei ${x.lieferant ? kontaktName(x.lieferant) : ""} ausgelöst (${n(x.netto).toFixed(2).replace(".", ",")} € netto)` } });
    return neu;
  });
}

export async function bestellungStornieren(b: AktuellerBenutzer, id: string) {
  rollePruefen(b, ["ADMIN", "BUERO"]);
  const x = await bestellungLaden(b, id);
  if (x.wareneingaenge.length || x.rechnungen.length) throw new FachFehler("Zu dieser Bestellung gibt es schon Lieferungen oder Rechnungen.");
  if (x.status === "ENTWURF") { await db.bestellung.delete({ where: { id: x.id } }); return null; }
  return db.bestellung.update({ where: { id: x.id }, data: { status: "STORNIERT" } });
}

function lieferstatus(p: { menge: Prisma.Decimal; geliefert: Prisma.Decimal; berechnet: Prisma.Decimal }[]) {
  const alles = p.every((x) => n(x.geliefert) >= n(x.menge) - 1e-6);
  const etwas = p.some((x) => n(x.geliefert) > 0);
  const abgerechnet = p.every((x) => n(x.berechnet) >= n(x.geliefert) - 1e-6);
  return alles ? (abgerechnet ? "ABGESCHLOSSEN" : "GELIEFERT") : etwas ? "TEILGELIEFERT" : "BESTELLT";
}

export const WareneingangEingabe = z.object({
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lieferschein: z.string().nullish(),
  notiz: z.string().nullish(),
  mengen: z.record(z.number().min(0)),
});

/**
 * Wareneingang buchen. Artikel mit Lager gehen als Zugang mit dem Bestellpreis ins Lager;
 * alles andere gilt als direkt auf die Baustelle geliefert.
 */
export async function wareneingangBuchen(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof WareneingangEingabe>) {
  rollePruefen(b, ["ADMIN", "BUERO", "KOLONNE"]);
  const x = await bestellungLaden(b, id);
  if (!["BESTELLT", "TEILGELIEFERT", "GELIEFERT"].includes(x.status)) throw new FachFehler("Wareneingang nur für ausgelöste Bestellungen.");
  const e = WareneingangEingabe.parse(eingabe);
  const zeilen = x.positionen.filter((p) => (e.mengen[p.id] ?? 0) > 0);
  if (!zeilen.length) throw new FachFehler("Bitte mindestens eine gelieferte Menge eintragen.");
  for (const p of zeilen) {
    const rest = n(p.menge) - n(p.geliefert);
    if (e.mengen[p.id] > rest * 1.1 + 1e-6) throw new FachFehler(`„${p.text}“: ${e.mengen[p.id]} geliefert, offen sind nur ${rest}. Mehrlieferungen über 10 % bitte mit dem Lieferanten klären.`);
  }
  // Lagerzugänge zuerst (eigene Transaktionen); dann Wareneingang mit Verweis
  const buchungen = new Map<string, string>();
  for (const p of zeilen) {
    if (p.artikelId && x.lagerId) {
      const bu = await buchen({ ...b, rolle: b.rolle === "KOLONNE" ? "BUERO" : b.rolle }, {
        art: "ZUGANG", artikelId: p.artikelId, menge: e.mengen[p.id], nachLagerId: x.lagerId, ekPreis: n(p.preis),
        beleg: leer(e.lieferschein) ?? x.nummer, notiz: `Wareneingang ${x.nummer}`,
      });
      buchungen.set(p.id, bu.id);
    }
  }
  await db.$transaction(async (tx) => {
    await tx.wareneingang.create({
      data: {
        bestellungId: x.id, datum: tag(e.datum), lieferschein: leer(e.lieferschein), notiz: leer(e.notiz), benutzerId: b.id,
        positionen: { create: zeilen.map((p) => ({ bestellPositionId: p.id, menge: e.mengen[p.id], lagerBuchungId: buchungen.get(p.id) ?? null })) },
      },
    });
    for (const p of zeilen) await tx.bestellPosition.update({ where: { id: p.id }, data: { geliefert: { increment: e.mengen[p.id] } } });
    const neu = await tx.bestellPosition.findMany({ where: { bestellungId: x.id } });
    await tx.bestellung.update({ where: { id: x.id }, data: { status: lieferstatus(neu) } });
    if (x.projektId) await tx.logbuchEintrag.create({ data: { projektId: x.projektId, benutzerId: b.id, art: "SYSTEM", text: `Wareneingang zu ${x.nummer}${e.lieferschein ? `, Lieferschein ${e.lieferschein}` : ""}` } });
  });
}

// ================================================================== Eingangsrechnungen

type Gelesen = {
  format?: string; xml?: string; xsdOk?: boolean; xsdFehler?: string | null; daten?: unknown; fehler?: string;
  kopf?: {
    typ: string | null; rechnungsnummer: string | null; datum: string | null; faellig: string | null; bestellnummer: string | null; leistungsdatum: string | null;
    netto: number; mwst: number; brutto: number; vorauszahlung: number; zahlbetrag: number; summePositionen: number; iban: string | null;
    skontoTage: number; skontoProzent: number;
    lieferant: { name: string | null; ustId: string | null; steuernummer: string | null; strasse: string | null; plz: string | null; ort: string | null; land: string | null; email: string | null; telefon: string | null };
    kaeufer: { name: string | null; ustId: string | null };
  };
  steuern?: { basis: number; betrag: number; kategorie: string | null; satz: number | null }[];
  positionen?: { nr: number; artNr: string | null; text: string; menge: number; einheit: string | null; preis: number; gesamt: number; steuersatz: number | null }[];
};

function lesen(name: string, daten: Buffer): Promise<Gelesen> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.PYTHON ?? "python3", ["-I", path.join(process.cwd(), "pdf", "eingang.py")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", () => { try { resolve(JSON.parse(out)); } catch { reject(new Error(`Leser ohne Antwort: ${err.slice(-300)}`)); } });
    p.stdin.end(JSON.stringify({ name, daten: daten.toString("base64") }));
  });
}

const ustNorm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").toUpperCase();

async function lieferantFinden(firmaId: string, l: { name: string | null; ustId: string | null }, iban: string | null) {
  if (l.ustId) {
    const k = await db.kontakt.findFirst({ where: { geloescht: false, ustId: ustNorm(l.ustId) } });
    if (k) return k;
  }
  if (iban) {
    const frueher = await db.eingangsrechnung.findFirst({ where: { firmaId, iban: iban.replace(/\s/g, "").toUpperCase(), lieferantId: { not: null } }, orderBy: { createdAt: "desc" } });
    if (frueher?.lieferantId) return db.kontakt.findUnique({ where: { id: frueher.lieferantId } });
  }
  if (l.name) return db.kontakt.findFirst({ where: { geloescht: false, firmenname: { equals: l.name, mode: "insensitive" } } });
  return null;
}

/** Datei als Eingangsrechnung erfassen (Upload oder E-Mail-Anhang). */
export async function eingangErfassen(firmaId: string, datei: { name: string; daten: Buffer }, quelle: "UPLOAD" | "EMAIL", emailId?: string | null) {
  if (datei.daten.length > 15 * 1024 * 1024) throw new FachFehler("Die Datei ist größer als 15 MB.");
  const g = await lesen(datei.name, datei.daten);
  if (g.fehler) throw new FachFehler(g.fehler);
  // Gleiche Datei noch einmal (z. B. Mail an zwei Postfächer): nicht doppelt anlegen
  const hash = createHash("sha256").update(datei.daten).digest("hex");
  const gleich = await db.eingangsrechnung.findFirst({ where: { firmaId, dateiHash: hash } });
  if (gleich) return gleich;

  const k = g.kopf;
  const lieferant = k ? await lieferantFinden(firmaId, k.lieferant, k.iban) : null;
  const bestellung = k?.bestellnummer ? await db.bestellung.findFirst({ where: { firmaId, nummer: k.bestellnummer.trim() } }) : null;
  const vorschlag = !bestellung && lieferant
    ? await db.bestellung.findMany({ where: { firmaId, lieferantId: lieferant.id, status: { in: ["BESTELLT", "TEILGELIEFERT", "GELIEFERT"] } }, take: 2 })
    : [];
  const zugeordnet = bestellung ?? (vorschlag.length === 1 ? vorschlag[0] : null);
  const datum = k?.datum ? tag(k.datum.slice(0, 10)) : null;
  const faellig = k?.faellig ? tag(k.faellig.slice(0, 10)) : null;

  const r = await db.eingangsrechnung.create({
    data: {
      firmaId, quelle, format: g.format ?? "PDF", dateiName: datei.name, datei: new Uint8Array(datei.daten), dateiHash: hash, xml: g.xml ?? null,
      daten: (g.daten ?? undefined) as Prisma.InputJsonValue | undefined,
      lieferantId: lieferant?.id ?? null, lieferantName: k?.lieferant.name ?? null, lieferantUstId: ustNorm(k?.lieferant.ustId) || null,
      iban: k?.iban?.replace(/\s/g, "").toUpperCase() ?? null, rechnungsnummer: k?.rechnungsnummer ?? null, datum, faellig,
      leistungsdatum: k?.leistungsdatum ?? null, bestellnummer: k?.bestellnummer ?? null,
      netto: k?.netto ?? 0, mwst: k?.mwst ?? 0, brutto: k?.brutto ?? 0, vorauszahlung: k?.vorauszahlung ?? 0, zahlbetrag: k?.zahlbetrag ?? 0,
      skontoProzent: k?.skontoProzent ?? 0, skontoTage: k?.skontoTage ?? 0,
      bestellungId: zugeordnet?.id ?? null, projektId: zugeordnet?.projektId ?? null, emailId: emailId ?? null,
      notiz: zugeordnet && !bestellung ? "Bestellung über den Lieferanten zugeordnet, bitte bestätigen." : null,
      positionen: { create: (g.positionen ?? []).map((p) => ({ nr: p.nr, artNr: p.artNr, text: p.text || "(ohne Text)", menge: p.menge, einheit: p.einheit, preis: p.preis, gesamt: p.gesamt, steuersatz: p.steuersatz })) },
    },
  });
  await pruefungAktualisieren(r.id, g);
  return r;
}

/** Automatische Prüfung (neu) laufen lassen und Ergebnis, Zuordnung und Status speichern. */
export async function pruefungAktualisieren(id: string, gelesen?: Gelesen): Promise<Pruefergebnis> {
  const r = await db.eingangsrechnung.findUniqueOrThrow({ where: { id }, include: { positionen: { orderBy: { nr: "asc" } }, firma: true, lieferant: true } });
  const bh = buchhaltungAus(r.firma.buchhaltung);
  const d = (r.daten ?? {}) as Record<string, unknown>;
  const bg4 = (d["BG-4"] ?? {}) as Record<string, string | undefined>;
  const steuern = gelesen?.steuern ?? ((d["BG-23"] as Record<string, string>[] | undefined) ?? []).map((t) => ({ basis: Number(t["BT-116"] ?? 0), betrag: Number(t["BT-117"] ?? 0), kategorie: t["BT-118"] ?? null, satz: t["BT-119"] != null ? Number(t["BT-119"]) : null }));
  const elektronisch = r.format !== "PDF";
  const bestellung = r.bestellungId ? await db.bestellung.findUnique({ where: { id: r.bestellungId }, include: { positionen: true } }) : null;
  // Früher berechnete Mengen anderer, schon freigegebener Rechnungen
  const doppelt = r.rechnungsnummer
    ? await db.eingangsrechnung.findFirst({
        where: { id: { not: r.id }, firmaId: r.firmaId, rechnungsnummer: r.rechnungsnummer, status: { not: "ABGELEHNT" },
          OR: [...(r.lieferantId ? [{ lieferantId: r.lieferantId }] : []), ...(r.lieferantUstId ? [{ lieferantUstId: r.lieferantUstId }] : []), ...(r.lieferantName ? [{ lieferantName: r.lieferantName }] : [])] },
      })
    : null;
  const bekannt = r.lieferantId
    ? (await db.eingangsrechnung.findMany({ where: { lieferantId: r.lieferantId, id: { not: r.id }, iban: { not: null }, status: { in: ["FREIGEGEBEN", "BEZAHLT"] } }, select: { iban: true }, distinct: ["iban"] })).map((x) => x.iban!)
    : [];
  const eingabe: PruefEingabe = {
    kopf: {
      rechnungsnummer: r.rechnungsnummer, datum: r.datum ? berlinTag(r.datum) : null, leistungsdatum: r.leistungsdatum,
      netto: n(r.netto), mwst: n(r.mwst), brutto: n(r.brutto), vorauszahlung: n(r.vorauszahlung), zahlbetrag: n(r.zahlbetrag),
      summePositionen: d["BT-106"] != null ? Number(d["BT-106"]) * (n(r.netto) < 0 ? -1 : 1) : null, iban: r.iban,
      lieferant: elektronisch
        ? { name: r.lieferantName, ustId: r.lieferantUstId, steuernummer: bg4.tax_registration_identifier ?? null, strasse: bg4.addr_l1 ?? null, plz: bg4.postcode ?? null, ort: bg4.city ?? null }
        : { name: r.lieferantName ?? (r.lieferant ? kontaktName(r.lieferant) : null), ustId: r.lieferantUstId ?? r.lieferant?.ustId ?? null, steuernummer: null, strasse: "von Hand", plz: null, ort: r.lieferant ? "von Hand" : null },
      kaeufer: { name: ((d["BG-7"] ?? {}) as Record<string, string>).name ?? null },
    },
    steuern, elektronisch, xsdOk: gelesen?.xsdOk ?? (elektronisch ? true : null), xsdFehler: gelesen?.xsdFehler ?? null,
    positionen: r.positionen.map((p) => ({ nr: p.nr, artNr: p.artNr, text: p.text, menge: n(p.menge), preis: n(p.preis), gesamt: n(p.gesamt) })),
    firmaName: r.firma.name,
    doppelt: doppelt ? { nummer: doppelt.rechnungsnummer!, datum: doppelt.datum ? datumText(doppelt.datum) : null } : null,
    bekannteIbans: bekannt,
    bestellung: bestellung ? {
      nummer: bestellung.nummer,
      positionen: bestellung.positionen.map((p) => ({ id: p.id, artNr: p.artNr, text: p.text, menge: n(p.menge), geliefert: n(p.geliefert), berechnetVorher: n(p.berechnet), preis: n(p.preis) })),
    } : null,
    toleranzProzent: bh.preisToleranz,
  };
  const erg = pruefen(eingabe);
  await db.$transaction([
    ...r.positionen.map((p) => db.eingangsPosition.update({ where: { id: p.id }, data: { bestellPositionId: erg.zuordnung[p.nr] ?? null } })),
    db.eingangsrechnung.update({
      where: { id: r.id },
      data: {
        pruefung: erg as unknown as Prisma.InputJsonValue, steuerUmkehr: erg.steuerUmkehr,
        // Reine PDFs bleiben „neu“, bis Nummer, Datum, Lieferant und Beträge eingetragen sind
        status: r.status === "NEU" && r.rechnungsnummer && r.datum && n(r.brutto) !== 0 && (r.lieferantId || r.lieferantName) ? "PRUEFUNG" : r.status,
      },
    }),
  ]);
  return erg;
}

export async function eingangLaden(b: AktuellerBenutzer, id: string) {
  const r = await db.eingangsrechnung.findUnique({
    where: { id }, omit: { datei: true },
    include: { positionen: { orderBy: { nr: "asc" }, include: { bestellPosition: true } }, lieferant: true, bestellung: { include: { positionen: { orderBy: { reihenfolge: "asc" } } } }, projekt: true, freigegebenVon: { select: { name: true } }, email: { select: { id: true, betreff: true, vonAdresse: true } } },
  });
  if (!r) throw new FachFehler("Rechnung nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, r.firmaId);
  return r;
}

export const EingangKopf = z.object({
  lieferantId: z.string().nullish(),
  rechnungsnummer: z.string().nullish(),
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  faellig: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  leistungsdatum: z.string().nullish(),
  netto: z.number().nullish(), mwst: z.number().nullish(), brutto: z.number().nullish(),
  bestellungId: z.string().nullish(),
  projektId: z.string().nullish(),
  kostenart: z.enum(["MATERIAL", "FREMDLEISTUNG", "GERAETE", "SONSTIGES"]),
  skontoProzent: z.number().min(0).max(20).nullish(), skontoTage: z.number().int().min(0).max(120).nullish(),
});

/**
 * Zuordnung ändern. Bei E-Rechnungen sind die Beträge fest (sie stehen im XML);
 * bei reinen PDFs trägt das Büro Nummer, Datum und Beträge ein.
 */
export async function eingangBearbeiten(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof EingangKopf>) {
  rollePruefen(b);
  const r = await eingangLaden(b, id);
  if (r.status === "FREIGEGEBEN" || r.status === "BEZAHLT") throw new FachFehler("Freigegebene Rechnungen lassen sich nicht mehr ändern.");
  const e = EingangKopf.parse(eingabe);
  if (e.bestellungId && !(await db.bestellung.findFirst({ where: { id: e.bestellungId, firmaId: r.firmaId } }))) throw new FachFehler("Bestellung nicht gefunden.");
  if (e.projektId && !(await db.projekt.findFirst({ where: { id: e.projektId, firmaId: r.firmaId } }))) throw new FachFehler("Projekt nicht gefunden.");
  const lieferant = e.lieferantId ? await db.kontakt.findUnique({ where: { id: e.lieferantId } }) : null;
  const bestellung = e.bestellungId ? await db.bestellung.findUnique({ where: { id: e.bestellungId } }) : null;
  const manuell = r.format === "PDF";
  const netto = e.netto ?? n(r.netto), mwst = e.mwst ?? n(r.mwst);
  await db.eingangsrechnung.update({
    where: { id: r.id },
    data: {
      lieferantId: lieferant?.id ?? null, bestellungId: bestellung?.id ?? null,
      projektId: e.projektId || bestellung?.projektId || null, kostenart: e.kostenart as Kostenart2,
      skontoProzent: e.skontoProzent ?? r.skontoProzent, skontoTage: e.skontoTage ?? r.skontoTage,
      ...(manuell ? {
        rechnungsnummer: leer(e.rechnungsnummer), datum: e.datum ? tag(e.datum) : null, faellig: e.faellig ? tag(e.faellig) : null, leistungsdatum: leer(e.leistungsdatum),
        netto, mwst, brutto: e.brutto ?? runden(netto + mwst), zahlbetrag: e.brutto ?? runden(netto + mwst),
        lieferantName: lieferant ? kontaktName(lieferant) : r.lieferantName, lieferantUstId: lieferant?.ustId ?? r.lieferantUstId,
      } : {}),
    },
  });
  return pruefungAktualisieren(r.id);
}

/** Lieferant aus den Angaben der E-Rechnung als Kontakt anlegen. */
export async function lieferantAusRechnung(b: AktuellerBenutzer, id: string) {
  rollePruefen(b);
  const r = await eingangLaden(b, id);
  if (r.lieferantId) throw new FachFehler("Der Lieferant ist schon zugeordnet.");
  const s = ((r.daten ?? {}) as Record<string, Record<string, unknown>>)["BG-4"] ?? {};
  const kontakte = (s.contacts as { email?: string; phone?: string }[] | undefined) ?? [];
  if (!r.lieferantName) throw new FachFehler("Die Rechnung enthält keinen Lieferantennamen.");
  const k = await db.kontakt.create({
    data: {
      typ: "LIEFERANT", kategorie: "GEWERBE", firmenname: r.lieferantName, ustId: r.lieferantUstId,
      email: kontakte[0]?.email ?? (s.einvoicing_addr as string | undefined) ?? null, telefon: kontakte[0]?.phone ?? null,
      adressen: s.city ? { create: { art: "HAUPT", strasse: (s.addr_l1 as string) ?? null, plz: (s.postcode as string) ?? null, ort: (s.city as string) ?? null, land: (s.country_code as string) ?? "DE" } } : undefined,
    },
  });
  await db.eingangsrechnung.update({ where: { id: r.id }, data: { lieferantId: k.id } });
  await pruefungAktualisieren(r.id);
  return k;
}

/** Freigabe zur Zahlung. Verbucht die berechneten Mengen an der Bestellung. */
export async function freigeben(b: AktuellerBenutzer, id: string, begruendung: string | null) {
  rollePruefen(b);
  const r = await eingangLaden(b, id);
  if (r.status !== "PRUEFUNG") throw new FachFehler(r.status === "NEU" ? "Bitte zuerst Rechnungsnummer, Datum, Lieferant und Beträge erfassen." : "Diese Rechnung ist nicht in Prüfung.");
  if (!r.lieferantId) throw new FachFehler("Bitte den Lieferanten zuordnen oder anlegen (für Zahlung und DATEV).");
  const firma = await db.firma.findUniqueOrThrow({ where: { id: r.firmaId } });
  const bh = buchhaltungAus(firma.buchhaltung);
  const erg = r.pruefung as unknown as Pruefergebnis | null;
  const fehler = erg?.regeln.filter((x) => x.status === "fehler") ?? [];
  if (fehler.length && b.rolle !== "ADMIN") throw new FachFehler("Die Prüfung hat Fehler gefunden. Nur ein Admin kann trotzdem freigeben, mit Begründung.");
  if (fehler.length && !leer(begruendung)) throw new FachFehler("Bitte begründen, warum trotz Fehler freigegeben wird.");
  if (b.rolle !== "ADMIN" && n(r.brutto) > bh.freigabeLimitBuero) throw new FachFehler(`Rechnungen über ${bh.freigabeLimitBuero.toLocaleString("de-DE")} € brutto gibt ein Admin frei.`);
  await db.$transaction(async (tx) => {
    for (const p of r.positionen) if (p.bestellPositionId) await tx.bestellPosition.update({ where: { id: p.bestellPositionId }, data: { berechnet: { increment: p.menge } } });
    if (r.bestellungId) {
      const pos = await tx.bestellPosition.findMany({ where: { bestellungId: r.bestellungId } });
      const best = await tx.bestellung.findUniqueOrThrow({ where: { id: r.bestellungId } });
      if (best.status !== "STORNIERT") await tx.bestellung.update({ where: { id: best.id }, data: { status: lieferstatus(pos) } });
    }
    await tx.eingangsrechnung.update({ where: { id: r.id }, data: { status: "FREIGEGEBEN", freigegebenVonId: b.id, freigegebenAm: new Date(), freigabeNotiz: leer(begruendung) } });
    if (r.projektId) await tx.logbuchEintrag.create({ data: { projektId: r.projektId, benutzerId: b.id, art: "SYSTEM", text: `Eingangsrechnung ${r.rechnungsnummer} von ${r.lieferantName ?? ""} freigegeben (${n(r.brutto).toFixed(2).replace(".", ",")} € brutto)` } });
  });
}

/** Freigabe zurücknehmen (nur Admin, nur solange nicht bezahlt). */
export async function freigabeZuruecknehmen(b: AktuellerBenutzer, id: string) {
  rollePruefen(b, ["ADMIN"]);
  const r = await eingangLaden(b, id);
  if (r.status !== "FREIGEGEBEN") throw new FachFehler("Nur freigegebene, noch nicht bezahlte Rechnungen.");
  await db.$transaction(async (tx) => {
    for (const p of r.positionen) if (p.bestellPositionId) await tx.bestellPosition.update({ where: { id: p.bestellPositionId }, data: { berechnet: { decrement: p.menge } } });
    if (r.bestellungId) {
      const pos = await tx.bestellPosition.findMany({ where: { bestellungId: r.bestellungId } });
      await tx.bestellung.update({ where: { id: r.bestellungId }, data: { status: lieferstatus(pos) } });
    }
    await tx.eingangsrechnung.update({ where: { id: r.id }, data: { status: "PRUEFUNG", freigegebenVonId: null, freigegebenAm: null } });
  });
}

export async function ablehnen(b: AktuellerBenutzer, id: string, grund: string) {
  rollePruefen(b);
  const r = await eingangLaden(b, id);
  if (!["NEU", "PRUEFUNG"].includes(r.status)) throw new FachFehler("Nur ungeprüfte oder geprüfte, nicht freigegebene Rechnungen lassen sich ablehnen.");
  if (!leer(grund)) throw new FachFehler("Bitte den Grund nennen (geht in die Reklamation an den Lieferanten).");
  await db.eingangsrechnung.update({ where: { id: r.id }, data: { status: "ABGELEHNT", ablehnGrund: grund.trim() } });
}

export async function alsBezahlt(b: AktuellerBenutzer, id: string, datum: string, betrag: number) {
  rollePruefen(b);
  const r = await eingangLaden(b, id);
  if (r.status !== "FREIGEGEBEN") throw new FachFehler("Bezahlt werden nur freigegebene Rechnungen.");
  if (!(betrag > 0)) throw new FachFehler("Betrag fehlt.");
  await db.eingangsrechnung.update({ where: { id: r.id }, data: { status: "BEZAHLT", bezahltAm: tag(datum), bezahltBetrag: betrag } });
}

export async function eingangDatei(b: AktuellerBenutzer, id: string) {
  const r = await db.eingangsrechnung.findUnique({ where: { id }, select: { firmaId: true, datei: true, dateiName: true, format: true } });
  if (!r) throw new FachFehler("Rechnung nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, r.firmaId);
  return r;
}

/** Zahlungsvorschlag: freigegebene Rechnungen nach Skontofrist bzw. Fälligkeit. */
export function zahlungsfrist(r: { datum: Date | null; faellig: Date | null; skontoProzent: Prisma.Decimal | number; skontoTage: number; zahlbetrag: Prisma.Decimal | number }) {
  const skonto = n(r.skontoProzent) > 0 && r.skontoTage > 0 && r.datum ? { bis: new Date(r.datum.getTime() + r.skontoTage * 864e5), betrag: runden((n(r.zahlbetrag) * n(r.skontoProzent)) / 100) } : null;
  const faellig = r.faellig ?? (r.datum ? new Date(r.datum.getTime() + 30 * 864e5) : null);
  return { skonto, faellig };
}

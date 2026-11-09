/**
 * Zahlungseingänge, offene Posten, Kontoauszug-Abgleich, Mahnwesen und DATEV-Export.
 * Alles je Mandant; Rechnungen anderer Firmen sind nie sichtbar.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { Prisma, ZahlungsArt } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { n, runden } from "../kalkulation";
import { berlinTag, berlinZuUtc } from "../zeit";
import { datum as datumText, kontaktName } from "../format";
import {
  offenerBetrag, opStatus, faellig, tageUeberfaellig, abgleichen, verzugszinsen, buchhaltungAus, MAHNSTUFE,
  datevKopf, datevZeile, DATEV_SPALTEN, alsAnsi, type Buchhaltung, type Kandidat, type Buchung,
} from "../faktura/op";
import { ART_TITEL } from "../faktura/texte";
import { FachFehler } from "./fehler";
import { rollePruefen } from "./zugriff";

const tag = (s: string) => berlinZuUtc(s, "12:00");

function python(skript: string, eingabe: Buffer | string, args: string[] = []): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.PYTHON ?? "python3", ["-I", path.join(process.cwd(), skript), ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = []; let err = "";
    p.stdout.on("data", (c) => out.push(c)); p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${skript}: ${err.slice(-500)}`))));
    p.stdin.end(eingabe);
  });
}

// ------------------------------------------------------------------ Offene Posten

const opInclude = {
  projekt: { include: { kontakt: true } },
  zahlungen: { orderBy: { datum: "asc" as const } },
  mahnungen: { orderBy: { datum: "asc" as const }, select: { id: true, stufe: true, datum: true, frist: true } },
} satisfies Prisma.RechnungInclude;

export async function offenePosten(b: AktuellerBenutzer, alle = false) {
  rollePruefen(b);
  const liste = await db.rechnung.findMany({
    where: { firmaId: b.mandant.id, status: { not: "ENTWURF" }, art: { not: "STORNO" } },
    include: opInclude, omit: { pdf: true, berechnung: true }, orderBy: { datum: "asc" },
  });
  const jetzt = new Date();
  return liste
    .map((r) => ({
      r, offen: offenerBetrag(r, r.zahlungen), status: opStatus(r, r.zahlungen, jetzt), faellig: faellig(r),
      tage: tageUeberfaellig(r, jetzt), mahnstufe: r.mahnungen.at(-1)?.stufe ?? 0, letzteMahnung: r.mahnungen.at(-1) ?? null,
    }))
    .filter((x) => alle || x.status !== "ausgeglichen");
}

// ------------------------------------------------------------------ Zahlungen

export const ZahlungEingabe = z.object({
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  betrag: z.number().positive("Betrag muss größer als 0 sein."),
  art: z.enum(["UEBERWEISUNG", "LASTSCHRIFT", "BAR", "SKONTO", "AUSBUCHUNG"]),
  notiz: z.string().nullish(),
});

async function rechnungFuerZahlung(b: AktuellerBenutzer, id: string) {
  const r = await db.rechnung.findUnique({ where: { id }, include: { zahlungen: true }, omit: { pdf: true } });
  if (!r || r.firmaId !== b.mandant.id) throw new FachFehler("Rechnung nicht gefunden.", "NICHT_GEFUNDEN");
  if (r.status === "ENTWURF") throw new FachFehler("Auf Entwürfe kann nicht gezahlt werden.");
  if (r.art === "STORNO") throw new FachFehler("Auf eine Stornorechnung wird nicht gezahlt.");
  return r;
}

export async function zahlungErfassen(b: AktuellerBenutzer, rechnungId: string, eingabe: z.input<typeof ZahlungEingabe>, bankumsatzId?: string, tx: Prisma.TransactionClient = db as unknown as Prisma.TransactionClient) {
  rollePruefen(b);
  const e = ZahlungEingabe.parse(eingabe);
  const r = await rechnungFuerZahlung(b, rechnungId);
  const offen = offenerBetrag(r, r.zahlungen);
  if (offen <= 0) throw new FachFehler(`Rechnung ${r.nummer} ist bereits ausgeglichen.`);
  if (e.betrag > offen + 0.005) throw new FachFehler(`Der Betrag übersteigt den offenen Betrag von ${offen.toFixed(2).replace(".", ",")} €. Eine Überzahlung bitte mit dem Kunden klären.`);
  if (e.art === "SKONTO" && e.betrag > runden((n(r.zahlbetrag) * Math.max(n(r.skontoProzent), 3)) / 100) + 0.005) {
    throw new FachFehler("Der Skontobetrag ist höher als der vereinbarte Skonto.");
  }
  const z = await tx.zahlung.create({
    data: { firmaId: r.firmaId, rechnungId: r.id, datum: tag(e.datum), betrag: e.betrag, art: e.art as ZahlungsArt, notiz: e.notiz || null, erfasstVonId: b.id, bankumsatzId: bankumsatzId ?? null },
  });
  await tx.logbuchEintrag.create({ data: { projektId: r.projektId, benutzerId: b.id, art: "SYSTEM", text: `Zahlung ${e.betrag.toFixed(2).replace(".", ",")} € (${e.art.toLowerCase()}) auf Rechnung ${r.nummer}` } });
  return z;
}

export async function zahlungLoeschen(b: AktuellerBenutzer, zahlungId: string) {
  rollePruefen(b);
  const z = await db.zahlung.findUnique({ where: { id: zahlungId }, include: { rechnung: { select: { nummer: true, projektId: true } } } });
  if (!z || z.firmaId !== b.mandant.id) throw new FachFehler("Zahlung nicht gefunden.", "NICHT_GEFUNDEN");
  await db.$transaction([
    db.zahlung.delete({ where: { id: z.id } }),
    ...(z.bankumsatzId ? [db.bankumsatz.update({ where: { id: z.bankumsatzId }, data: { erledigt: false } })] : []),
    db.logbuchEintrag.create({ data: { projektId: z.rechnung.projektId, benutzerId: b.id, art: "SYSTEM", text: `Zahlung ${n(z.betrag).toFixed(2).replace(".", ",")} € auf ${z.rechnung.nummer} gelöscht` } }),
  ]);
}

// ------------------------------------------------------------------ Kontoauszug

type CamtUmsatz = { referenz: string; buchungstag: string; betrag: number; name: string | null; iban: string | null; verwendungszweck: string | null };

export async function kontoauszugImportieren(b: AktuellerBenutzer, name: string, daten: Buffer) {
  rollePruefen(b);
  if (daten.length > 20 * 1024 * 1024) throw new FachFehler("Die Datei ist größer als 20 MB.");
  const j = JSON.parse((await python("bank/camt.py", daten)).toString("utf8")) as CamtUmsatz[] | { fehler: string };
  if (!Array.isArray(j)) throw new FachFehler(j.fehler);
  if (!j.length) throw new FachFehler("Keine gebuchten Umsätze gefunden. Erwartet wird ein Kontoauszug im Format CAMT.053.");
  let neu = 0;
  for (const u of j) {
    const r = await db.bankumsatz.createMany({
      data: [{ firmaId: b.mandant.id, referenz: u.referenz, buchungstag: tag(u.buchungstag), betrag: u.betrag, name: u.name, iban: u.iban, verwendungszweck: u.verwendungszweck, quelle: name, erledigt: u.betrag <= 0 }],
      skipDuplicates: true,
    });
    neu += r.count;
  }
  return { gelesen: j.length, neu, doppelt: j.length - neu };
}

export async function abgleichListe(b: AktuellerBenutzer) {
  rollePruefen(b);
  const [umsaetze, op] = await Promise.all([
    db.bankumsatz.findMany({ where: { firmaId: b.mandant.id, erledigt: false }, orderBy: { buchungstag: "asc" }, take: 300 }),
    offenePosten(b),
  ]);
  const kandidaten: Kandidat[] = op.filter((x) => x.offen > 0).map((x) => ({
    id: x.r.id, nummer: x.r.nummer ?? "", offen: x.offen, kunde: kontaktName(x.r.projekt.kontakt), datum: x.r.datum,
    skontoProzent: n(x.r.skontoProzent), skontoTage: x.r.skontoTage,
  }));
  return { kandidaten, zeilen: umsaetze.map((u) => ({ u, vorschlag: abgleichen({ betrag: n(u.betrag), verwendungszweck: u.verwendungszweck, name: u.name, buchungstag: u.buchungstag }, kandidaten) })) };
}

/** Zuordnung übernehmen: Zahlung (und Skonto) zur Rechnung, Umsatz erledigt. */
export async function abgleichUebernehmen(b: AktuellerBenutzer, bankumsatzId: string, rechnungId: string, skonto: number) {
  rollePruefen(b);
  const u = await db.bankumsatz.findUnique({ where: { id: bankumsatzId } });
  if (!u || u.firmaId !== b.mandant.id || u.erledigt) throw new FachFehler("Umsatz nicht gefunden oder schon zugeordnet.");
  await db.$transaction(async (tx) => {
    const t = berlinTag(u.buchungstag);
    await zahlungErfassen(b, rechnungId, { datum: t, betrag: n(u.betrag), art: "UEBERWEISUNG", notiz: [u.name, u.verwendungszweck].filter(Boolean).join(" · ").slice(0, 300) }, u.id, tx);
    if (skonto > 0) await zahlungErfassen(b, rechnungId, { datum: t, betrag: skonto, art: "SKONTO", notiz: "Skonto laut Zahlungseingang" }, u.id, tx);
    await tx.bankumsatz.update({ where: { id: u.id }, data: { erledigt: true } });
  });
}

export async function umsatzUebergehen(b: AktuellerBenutzer, id: string) {
  rollePruefen(b);
  const u = await db.bankumsatz.findUnique({ where: { id } });
  if (!u || u.firmaId !== b.mandant.id) throw new FachFehler("Umsatz nicht gefunden.");
  await db.bankumsatz.update({ where: { id }, data: { erledigt: true } });
}

// ------------------------------------------------------------------ Einstellungen Buchhaltung

export const BuchhaltungEingabe = z.object({
  beraterNr: z.string().regex(/^\d{0,7}$/, "Beraternummer: bis 7 Ziffern"),
  mandantNr: z.string().regex(/^\d{0,5}$/, "Mandantennummer: bis 5 Ziffern"),
  wjBeginnMonat: z.number().int().min(1).max(12),
  debitorStart: z.number().int().min(10000).max(69999),
  kontoErloese19: z.string().regex(/^\d{4}$/), kontoErloese7: z.string().regex(/^\d{4}$/), kontoErloese13b: z.string().regex(/^\d{4}$/),
  kontoErloeseFrei: z.string().regex(/^\d{4}$/), kontoSkonto: z.string().regex(/^\d{4}$/), kontoBank: z.string().regex(/^\d{4}$/),
  kontoKasse: z.string().regex(/^\d{4}$/), kontoAusbuchung: z.string().regex(/^\d{4}$/),
  mahnFristTage: z.number().int().min(1).max(60),
  gebuehrStufe2: z.number().min(0).max(100), gebuehrStufe3: z.number().min(0).max(100),
  basiszins: z.number().min(-5).max(20).nullable(),
});

export async function buchhaltungSpeichern(b: AktuellerBenutzer, eingabe: z.input<typeof BuchhaltungEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  await db.firma.update({ where: { id: b.mandant.id }, data: { buchhaltung: BuchhaltungEingabe.parse(eingabe) } });
}

export async function buchhaltungLaden(firmaId: string): Promise<Buchhaltung> {
  const f = await db.firma.findUniqueOrThrow({ where: { id: firmaId }, select: { buchhaltung: true } });
  return buchhaltungAus(f.buchhaltung);
}

// ------------------------------------------------------------------ Mahnungen

export const MahnEingabe = z.object({ zinsen: z.boolean().default(false), pauschale: z.boolean().default(false) });

export async function mahnungErstellen(b: AktuellerBenutzer, rechnungId: string, eingabe: z.input<typeof MahnEingabe>, pdfBauen: (daten: unknown) => Promise<Buffer>) {
  rollePruefen(b);
  const e = MahnEingabe.parse(eingabe);
  const r = await db.rechnung.findUnique({ where: { id: rechnungId }, include: { ...opInclude, firma: true }, omit: { pdf: true } });
  if (!r || r.firmaId !== b.mandant.id) throw new FachFehler("Rechnung nicht gefunden.", "NICHT_GEFUNDEN");
  const offen = offenerBetrag(r, r.zahlungen);
  if (opStatus(r, r.zahlungen) !== "ueberfaellig") throw new FachFehler("Gemahnt werden nur überfällige Rechnungen mit offenem Betrag.");
  const stufe = (r.mahnungen.at(-1)?.stufe ?? 0) + 1;
  if (stufe > 3) throw new FachFehler("Die 2. Mahnung ist die letzte Stufe. Danach bitte gerichtliches Mahnverfahren oder Inkasso prüfen.");
  const bh = buchhaltungAus(r.firma.buchhaltung);
  const verbraucher = r.projekt.kontakt.kategorie === "PRIVAT";
  const gebuehr = stufe === 2 ? bh.gebuehrStufe2 : stufe === 3 ? bh.gebuehrStufe3 : 0;
  if (e.zinsen && bh.basiszins == null) throw new FachFehler("Für Verzugszinsen bitte zuerst den aktuellen Basiszinssatz unter Einstellungen → Buchhaltung eintragen.");
  // Verzug ab der ersten Mahnung (Zahlungserinnerung), Zinsen bis heute
  const verzugAb = r.mahnungen[0]?.datum ?? null;
  const zinsTage = verzugAb ? Math.round((Date.parse(berlinTag(new Date())) - Date.parse(berlinTag(verzugAb))) / 864e5) : 0;
  const zinsen = e.zinsen ? verzugszinsen(offen, bh.basiszins ?? 0, verbraucher, zinsTage) : 0;
  const schonPauschale = await db.mahnung.count({ where: { rechnungId: r.id, pauschale: { gt: 0 } } });
  const pauschale = e.pauschale && !verbraucher && stufe >= 2 && !schonPauschale ? 40 : 0;
  if (e.pauschale && verbraucher) throw new FachFehler("Die Verzugspauschale von 40 € gilt nur gegenüber Unternehmern (§ 288 Abs. 5 BGB).");
  const datum = new Date();
  const frist = tag(berlinTag(new Date(datum.getTime() + bh.mahnFristTage * 864e5)));

  const daten = mahnDaten(r, { stufe, offen, gebuehr, zinsen, zinsTage, pauschale, frist, datum, verbraucher, basiszins: bh.basiszins });
  const pdf = await pdfBauen(daten);
  const m = await db.mahnung.create({
    data: { firmaId: r.firmaId, rechnungId: r.id, stufe, datum, frist, offen, gebuehr, zinsen, pauschale, pdf: new Uint8Array(pdf), erstelltVonId: b.id },
  });
  await db.logbuchEintrag.create({ data: { projektId: r.projektId, benutzerId: b.id, art: "SYSTEM", text: `${MAHNSTUFE[stufe]} zu Rechnung ${r.nummer} erstellt (offen ${offen.toFixed(2).replace(".", ",")} €)` } });
  return m;
}

type MahnRechnung = Omit<Prisma.RechnungGetPayload<{ include: typeof opInclude & { firma: true } }>, "pdf">;

function mahnDaten(r: MahnRechnung, m: { stufe: number; offen: number; gebuehr: number; zinsen: number; zinsTage: number; pauschale: number; frist: Date; datum: Date; verbraucher: boolean; basiszins: number | null }) {
  const emp = (r.empfaenger as { zeilen: string[]; kundennummer: string } | null) ?? { zeilen: [kontaktName(r.projekt.kontakt)], kundennummer: r.projekt.kontakt.nummer ?? "" };
  const eur = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gesamt = runden(m.offen + m.gebuehr + m.zinsen + m.pauschale);
  const titel = MAHNSTUFE[m.stufe];
  const gezahlt = runden(r.zahlungen.reduce((s, z) => s + n(z.betrag), 0));
  const einleitung = {
    1: `sicher ist es Ihrer Aufmerksamkeit entgangen: Unsere ${ART_TITEL[r.art]} ${r.nummer} vom ${datumText(r.datum)} war am ${datumText(faellig(r))} fällig und ist noch nicht vollständig bezahlt.`,
    2: `auf unsere Zahlungserinnerung haben wir keinen Zahlungseingang festgestellt. Die ${ART_TITEL[r.art]} ${r.nummer} vom ${datumText(r.datum)} ist seit dem ${datumText(faellig(r))} fällig.`,
    3: `trotz Erinnerung und Mahnung ist die ${ART_TITEL[r.art]} ${r.nummer} vom ${datumText(r.datum)} weiterhin offen. Dies ist unsere letzte Mahnung.`,
  }[m.stufe]!;
  const schluss = {
    1: `Bitte überweisen Sie ${eur(gesamt)} € bis zum ${datumText(m.frist)}. Hat sich Ihre Zahlung mit diesem Schreiben gekreuzt, betrachten Sie es bitte als gegenstandslos.`,
    2: `Bitte überweisen Sie ${eur(gesamt)} € bis zum ${datumText(m.frist)} unter Angabe der Rechnungsnummer ${r.nummer}.`,
    3: `Bitte überweisen Sie ${eur(gesamt)} € bis spätestens ${datumText(m.frist)}. Geht bis dahin keine Zahlung ein, beantragen wir ohne weitere Ankündigung einen Mahnbescheid; die Kosten tragen Sie.`,
  }[m.stufe]!;
  const abrechnung = [
    { label: "Rechnungsbetrag", betrag: n(r.zahlbetrag) },
    ...(gezahlt ? [{ label: "bereits gezahlt", betrag: -gezahlt }] : []),
    { label: "offen", betrag: m.offen },
    ...(m.gebuehr ? [{ label: "Mahngebühr", betrag: m.gebuehr }] : []),
    ...(m.zinsen ? [{ label: `Verzugszinsen ${m.zinsTage} Tage`, betrag: m.zinsen }] : []),
    ...(m.pauschale ? [{ label: "Verzugspauschale § 288 Abs. 5 BGB", betrag: m.pauschale }] : []),
    { label: "zu zahlen", betrag: gesamt },
  ];
  return {
    firma: r.firma.kuerzel, dokumentart: titel, belegnummer: r.nummer ?? "", belegLabel: "zur Rechnung:", datum: datumText(m.datum), gueltigBis: "",
    empfaenger: emp.zeilen, kundennummer: emp.kundennummer, ansprechpartner: "", betreff: `${titel} zur ${ART_TITEL[r.art]} ${r.nummer} – ${r.betreff}`,
    anrede: r.anrede ?? "Sehr geehrte Damen und Herren,", einleitung, vorbemerkung: "", schlusstext: schluss, verbraucher: m.verbraucher,
    infosZusatz: [["Rechnung vom", datumText(r.datum)], ["fällig seit", datumText(faellig(r))], ["Zahlungsfrist", datumText(m.frist)]],
    vortext: [`Rechnung vom ${datumText(r.datum)}, fällig seit ${datumText(faellig(r))}, Zahlungsfrist ${datumText(m.frist)}`],
    mengennachweis: false,
    positionen: [{ art: "POSITION", posNr: "1", kurztext: `${ART_TITEL[r.art]} ${r.nummer} vom ${datumText(r.datum)}`, langtext: r.betreff, menge: 1, einheit: "", einzelpreis: m.offen, gesamt: m.offen, bedarf: false }],
    summen: { netto: m.offen, mwst: 0, brutto: m.offen, mwstSatz: 0, lohnanteilBrutto: 0 },
    rechnung: {
      abrechnung, weitere: abrechnung.slice(abrechnung.findIndex((a) => a.label === "offen") + 1),
      vorrechnungen: [], hinweise: m.zinsen && m.basiszins != null
        ? [{ titel: "Verzugszinsen", text: `${m.verbraucher ? 5 : 9} Prozentpunkte über dem Basiszinssatz von ${String(m.basiszins).replace(".", ",")} % (§ 288 BGB) auf ${eur(m.offen)} € für ${m.zinsTage} Tage.` }]
        : [],
      zahlung: "",
    },
  };
}

export async function mahnungPdf(b: AktuellerBenutzer, id: string) {
  const m = await db.mahnung.findUnique({ where: { id }, include: { rechnung: { select: { nummer: true } } } });
  if (!m || m.firmaId !== b.mandant.id || !m.pdf) throw new FachFehler("Mahnung nicht gefunden.", "NICHT_GEFUNDEN");
  return { pdf: m.pdf, name: `${MAHNSTUFE[m.stufe].replace(/[ .]+/g, "_")}_${m.rechnung.nummer}.pdf` };
}

// ------------------------------------------------------------------ DATEV

/** Debitorennummer je Kunde und Firma; wird beim ersten Export vergeben und bleibt. */
async function debitor(tx: Prisma.TransactionClient, firmaId: string, kontaktId: string, start: number) {
  const vorhanden = await tx.kontaktFremdId.findUnique({ where: { kontaktId_firmaId_system: { kontaktId, firmaId, system: "DATEV" } } });
  if (vorhanden) return vorhanden.fremdId;
  const alle = await tx.kontaktFremdId.findMany({ where: { firmaId, system: "DATEV" }, select: { fremdId: true } });
  const nr = String(Math.max(start - 1, ...alle.map((a) => Number(a.fremdId)).filter(Number.isFinite)) + 1);
  await tx.kontaktFremdId.create({ data: { kontaktId, firmaId, system: "DATEV", fremdId: nr } });
  return nr;
}

/**
 * DATEV-Export für die Kanzlei: Buchungsstapel (EXTF, SKR03) mit Ausgangsrechnungen und
 * Zahlungseingängen im Zeitraum, Debitorenliste und die festgeschriebenen Rechnungs-PDFs als ZIP.
 */
export async function datevExport(b: AktuellerBenutzer, von: string, bis: string) {
  rollePruefen(b);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis) || von > bis) throw new FachFehler("Bitte einen gültigen Zeitraum wählen.");
  const bh = await buchhaltungLaden(b.mandant.id);
  if (!bh.beraterNr || !bh.mandantNr) throw new FachFehler("Bitte zuerst Berater- und Mandantennummer unter Einstellungen → Buchhaltung eintragen.");
  const wjJahr = Number(von.slice(0, 4)) - (Number(von.slice(5, 7)) < bh.wjBeginnMonat ? 1 : 0);
  const wjBeginn = `${wjJahr}-${String(bh.wjBeginnMonat).padStart(2, "0")}-01`;
  const wjEnde = `${wjJahr + 1}-${String(bh.wjBeginnMonat).padStart(2, "0")}-01`;
  if (bis >= wjEnde) throw new FachFehler("Der Zeitraum muss in einem Wirtschaftsjahr liegen.");
  const ab = berlinZuUtc(von), bisEx = berlinZuUtc(bis, "23:59");

  const [rechnungen, zahlungen] = await Promise.all([
    db.rechnung.findMany({ where: { firmaId: b.mandant.id, status: { not: "ENTWURF" }, datum: { gte: ab, lte: bisEx } }, include: { projekt: { include: { kontakt: { include: { adressen: true } } } } }, orderBy: [{ datum: "asc" }, { nummer: "asc" }] }),
    db.zahlung.findMany({ where: { firmaId: b.mandant.id, datum: { gte: ab, lte: bisEx } }, include: { rechnung: { include: { projekt: { include: { kontakt: true } } } } }, orderBy: { datum: "asc" } }),
  ]);

  const buchungen: Buchung[] = [];
  const debitoren = new Map<string, { nr: string; k: (typeof rechnungen)[number]["projekt"]["kontakt"] | (typeof zahlungen)[number]["rechnung"]["projekt"]["kontakt"] }>();
  await db.$transaction(async (tx) => {
    const deb = async (k: { id: string }) => {
      const nr = await debitor(tx, b.mandant.id, k.id, bh.debitorStart);
      return nr;
    };
    for (const r of rechnungen) {
      const nr = await deb(r.projekt.kontakt);
      debitoren.set(nr, { nr, k: r.projekt.kontakt });
      const satz = n(r.mwstSatz);
      const erloese = r.steuerschuldUmkehr ? bh.kontoErloese13b : satz === 19 ? bh.kontoErloese19 : satz === 7 ? bh.kontoErloese7 : bh.kontoErloeseFrei;
      buchungen.push({ betrag: n(r.brutto), konto: nr, gegenkonto: erloese, datum: r.datum, beleg: r.nummer ?? "", text: `${ART_TITEL[r.art]} ${kontaktName(r.projekt.kontakt)}` });
    }
    for (const z of zahlungen) {
      const nr = await deb(z.rechnung.projekt.kontakt);
      debitoren.set(nr, { nr, k: z.rechnung.projekt.kontakt });
      const konto = z.art === "BAR" ? bh.kontoKasse : z.art === "SKONTO" ? bh.kontoSkonto : z.art === "AUSBUCHUNG" ? bh.kontoAusbuchung : bh.kontoBank;
      buchungen.push({ betrag: n(z.betrag), konto, gegenkonto: nr, datum: z.datum, beleg: z.rechnung.nummer ?? "", text: `${z.art === "SKONTO" ? "Skonto" : z.art === "AUSBUCHUNG" ? "Ausbuchung" : "Zahlung"} ${kontaktName(z.rechnung.projekt.kontakt)}` });
    }
  });

  const kompakt = (s: string) => s.replace(/-/g, "");
  const csv = [
    datevKopf({ beraterNr: bh.beraterNr, mandantNr: bh.mandantNr, wjBeginn: kompakt(wjBeginn), von: kompakt(von), bis: kompakt(bis), bezeichnung: `ERP ${b.mandant.kuerzel} ${von.slice(0, 7)}` }),
    DATEV_SPALTEN.map((s) => `"${s}"`).join(";"),
    ...buchungen.map(datevZeile),
  ].join("\r\n") + "\r\n";
  const debCsv = ["Konto;Name;Vorname;Firma;Straße;PLZ;Ort;E-Mail;Kundennummer",
    ...[...debitoren.values()].sort((a, c) => a.nr.localeCompare(c.nr)).map(({ nr, k }) => {
      const a = ("adressen" in k ? (k.adressen as { art: string; strasse: string | null; plz: string | null; ort: string | null }[]) : []).find((x) => x.art === "RECHNUNG") ?? ("adressen" in k ? (k.adressen as { strasse: string | null; plz: string | null; ort: string | null }[])[0] : undefined);
      return [nr, k.nachname ?? "", k.vorname ?? "", k.firmenname ?? "", a?.strasse ?? "", a?.plz ?? "", a?.ort ?? "", k.email ?? "", k.nummer ?? ""].map((v) => `"${String(v).replace(/"/g, "'")}"`).join(";");
    })].join("\r\n") + "\r\n";

  const pdfs = await db.rechnung.findMany({ where: { id: { in: rechnungen.map((r) => r.id) } }, select: { nummer: true, art: true, pdf: true } });
  const name = `DATEV_${b.mandant.kuerzel}_${von}_${bis}`;
  const dateien = [
    { name: `EXTF_Buchungsstapel_${b.mandant.kuerzel}_${kompakt(von)}_${kompakt(bis)}.csv`, daten: alsAnsi(csv).toString("base64") },
    { name: "Debitoren.csv", daten: alsAnsi(debCsv).toString("base64") },
    ...pdfs.filter((p) => p.pdf).map((p) => ({ name: `Belege/${ART_TITEL[p.art].replace(/\s/g, "_")}_${p.nummer}.pdf`, daten: Buffer.from(p.pdf!).toString("base64") })),
  ];
  const zip = await python("bank/zip.py", JSON.stringify(dateien));
  return { name: `${name}.zip`, zip, rechnungen: rechnungen.length, zahlungen: zahlungen.length };
}

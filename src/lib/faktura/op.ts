/**
 * Offene Posten, Zahlungsabgleich, Mahnbeträge und DATEV-Buchungszeilen.
 * Reine Funktionen ohne Datenbank.
 */
import { n, runden } from "../kalkulation";
import { berlinTag } from "../zeit";

type Zahl = Parameters<typeof n>[0];

// ------------------------------------------------------------------ Einstellungen

export type Buchhaltung = {
  beraterNr: string; mandantNr: string; wjBeginnMonat: number; debitorStart: number;
  kontoErloese19: string; kontoErloese7: string; kontoErloese13b: string; kontoErloeseFrei: string;
  kontoSkonto: string; kontoBank: string; kontoKasse: string; kontoAusbuchung: string;
  mahnFristTage: number; gebuehrStufe2: number; gebuehrStufe3: number; basiszins: number | null;
  // Einkauf
  kreditorStart: number; kontoWareneingang: string; kontoFremdleistung: string; kontoSonstiges: string;
  freigabeLimitBuero: number; bestellLimitBuero: number; preisToleranz: number;
};

/** Standard SKR03. Die Kanzlei sollte die Konten einmal bestätigen. */
export const BUCHHALTUNG_STANDARD: Buchhaltung = {
  beraterNr: "", mandantNr: "", wjBeginnMonat: 1, debitorStart: 10000,
  kontoErloese19: "8400", kontoErloese7: "8300", kontoErloese13b: "8337", kontoErloeseFrei: "8200",
  kontoSkonto: "8736", kontoBank: "1200", kontoKasse: "1000", kontoAusbuchung: "2400",
  mahnFristTage: 10, gebuehrStufe2: 0, gebuehrStufe3: 0, basiszins: null,
  kreditorStart: 70000, kontoWareneingang: "3200", kontoFremdleistung: "3100", kontoSonstiges: "4900",
  freigabeLimitBuero: 5000, bestellLimitBuero: 5000, preisToleranz: 2,
};

export const buchhaltungAus = (json: unknown): Buchhaltung => ({ ...BUCHHALTUNG_STANDARD, ...((json as Partial<Buchhaltung>) ?? {}) });

// ------------------------------------------------------------------ Offene Posten

export type OpRechnung = {
  status: "ENTWURF" | "FESTGESCHRIEBEN" | "STORNIERT"; art: string; datum: Date; zahlungszielTage: number;
  zahlbetrag: Zahl; skontoProzent: Zahl; skontoTage: number;
};
export type OpZahlung = { betrag: Zahl };

export const bezahlt = (zahlungen: OpZahlung[]) => runden(zahlungen.reduce((s, z) => s + n(z.betrag), 0));

/**
 * Offener Betrag: Zahlbetrag minus Zahlungen. Stornorechnungen sind nie offen; eine stornierte
 * Rechnung ist nur offen, wenn schon gezahlt wurde (dann als Erstattung, negativ).
 */
export function offenerBetrag(r: OpRechnung, zahlungen: OpZahlung[]) {
  if (r.status === "ENTWURF" || r.art === "STORNO") return 0;
  const gezahlt = bezahlt(zahlungen);
  if (r.status === "STORNIERT") return runden(-gezahlt);
  return runden(n(r.zahlbetrag) - gezahlt);
}

export const faellig = (r: Pick<OpRechnung, "datum" | "zahlungszielTage">) => new Date(r.datum.getTime() + r.zahlungszielTage * 864e5);

export function opStatus(r: OpRechnung, zahlungen: OpZahlung[], jetzt = new Date()) {
  const offen = offenerBetrag(r, zahlungen);
  if (Math.abs(offen) < 0.005) return "ausgeglichen" as const;
  if (offen < 0) return "erstatten" as const;
  if (berlinTag(jetzt) > berlinTag(faellig(r))) return "ueberfaellig" as const;
  return bezahlt(zahlungen) > 0 ? ("teilbezahlt" as const) : ("offen" as const);
}

export const OP_TEXT = { ausgeglichen: "bezahlt", erstatten: "Erstattung offen", ueberfaellig: "überfällig", teilbezahlt: "teilweise bezahlt", offen: "offen" } as const;

/** Tage seit Fälligkeit (Berliner Kalendertage). */
export function tageUeberfaellig(r: Pick<OpRechnung, "datum" | "zahlungszielTage">, jetzt = new Date()) {
  const a = Date.parse(berlinTag(faellig(r))), b = Date.parse(berlinTag(jetzt));
  return Math.max(0, Math.round((b - a) / 864e5));
}

// ------------------------------------------------------------------ Bankabgleich

export type Umsatz = { betrag: number; verwendungszweck: string | null; name: string | null; buchungstag: Date };
export type Kandidat = { id: string; nummer: string; offen: number; kunde: string; datum: Date; skontoProzent: number; skontoTage: number };
export type Vorschlag = { rechnungId: string; betrag: number; skonto: number; sicherheit: "sicher" | "pruefen"; grund: string } | null;

const kompakt = (s: string) => s.toUpperCase().replace(/[\s.\-_/]/g, "");

/**
 * Zahlungseingang einer Rechnung zuordnen:
 * 1. Rechnungsnummer im Verwendungszweck → sicher, wenn der Betrag dem offenen Betrag oder dem
 *    offenen Betrag abzüglich Skonto (innerhalb der Skontofrist) entspricht, sonst prüfen.
 * 2. Ohne Nummer: genau eine offene Rechnung mit gleichem Betrag → prüfen.
 */
export function abgleichen(u: Umsatz, kandidaten: Kandidat[]): Vorschlag {
  if (u.betrag <= 0) return null;
  const zweck = kompakt(`${u.verwendungszweck ?? ""}`);
  const treffer = kandidaten.filter((k) => k.offen > 0 && zweck.includes(kompakt(k.nummer)));
  // Längste Nummer zuerst (2026-11 soll nicht 2026-114 schlagen)
  treffer.sort((a, b) => b.nummer.length - a.nummer.length);
  const k = treffer[0];
  if (k) {
    if (Math.abs(u.betrag - k.offen) < 0.01) return { rechnungId: k.id, betrag: u.betrag, skonto: 0, sicherheit: "sicher", grund: `Rechnungsnummer ${k.nummer}, Betrag passt` };
    const skonto = runden((k.offen * k.skontoProzent) / 100);
    const inFrist = k.skontoTage > 0 && u.buchungstag.getTime() <= k.datum.getTime() + (k.skontoTage + 3) * 864e5;
    if (skonto > 0 && inFrist && Math.abs(u.betrag - (k.offen - skonto)) < 0.01) {
      return { rechnungId: k.id, betrag: u.betrag, skonto, sicherheit: "sicher", grund: `Rechnungsnummer ${k.nummer}, ${k.skontoProzent} % Skonto abgezogen` };
    }
    return { rechnungId: k.id, betrag: Math.min(u.betrag, k.offen), skonto: 0, sicherheit: "pruefen", grund: `Rechnungsnummer ${k.nummer}, aber Betrag ${u.betrag.toFixed(2)} statt ${k.offen.toFixed(2)}` };
  }
  const gleich = kandidaten.filter((x) => x.offen > 0 && Math.abs(x.offen - u.betrag) < 0.01);
  if (gleich.length === 1) return { rechnungId: gleich[0].id, betrag: u.betrag, skonto: 0, sicherheit: "pruefen", grund: `Betrag passt zu ${gleich[0].nummer} (${gleich[0].kunde}), Nummer fehlt im Verwendungszweck` };
  return null;
}

// ------------------------------------------------------------------ Mahnung

/** Verzugszinsen (§ 288 BGB): Basiszins + 5 Prozentpunkte (Verbraucher) bzw. + 9 (Unternehmer), taggenau /365. */
export function verzugszinsen(betrag: number, basiszins: number, verbraucher: boolean, tage: number) {
  if (betrag <= 0 || tage <= 0) return 0;
  return runden((betrag * (basiszins + (verbraucher ? 5 : 9)) * tage) / 36500);
}

export const MAHNSTUFE = { 1: "Zahlungserinnerung", 2: "1. Mahnung", 3: "2. Mahnung" } as Record<number, string>;

// ------------------------------------------------------------------ DATEV

/** Betrag im DATEV-Format: ohne Tausenderpunkt, Komma, zwei Stellen. */
export const datevBetrag = (v: number) => Math.abs(v).toFixed(2).replace(".", ",");
/** Belegdatum TTMM. */
export const datevDatum = (d: Date) => { const t = berlinTag(d); return t.slice(8, 10) + t.slice(5, 7); };
export const datevText = (s: string, max = 60) => `"${s.replace(/"/g, "'").replace(/[\r\n;]+/g, " ").slice(0, max)}"`;

export type Buchung = { betrag: number; konto: string; gegenkonto: string; datum: Date; beleg: string; text: string; bu?: string };

/** Eine Zeile im Buchungsstapel: Soll/Haben nach Vorzeichen (negativ = Haben, also Umkehrbuchung). */
export const datevZeile = (b: Buchung) =>
  [datevBetrag(b.betrag), b.betrag < 0 ? '"H"' : '"S"', '"EUR"', "", "", "", b.konto, b.gegenkonto, b.bu ? `"${b.bu}"` : "", datevDatum(b.datum), datevText(b.beleg, 36), '""', "", datevText(b.text)].join(";");

export const DATEV_SPALTEN = [
  "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz",
  "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext",
];

/** Kopfzeile EXTF Buchungsstapel (Formatversion 700, Kategorie 21). */
export function datevKopf(o: { beraterNr: string; mandantNr: string; wjBeginn: string; von: string; bis: string; bezeichnung: string; jetzt?: Date }) {
  const j = o.jetzt ?? new Date();
  const zeit = j.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
  return ['"EXTF"', 700, 21, '"Buchungsstapel"', 13, zeit, "", '"RE"', '""', '""', o.beraterNr, o.mandantNr, o.wjBeginn, 4, o.von, o.bis,
    datevText(o.bezeichnung, 30), '""', 1, 0, 0, '"EUR"', "", '""', "", "", '"03"', "", "", '""', '""'].join(";");
}

/** Windows-1252 (DATEV erwartet ANSI). Unbekannte Zeichen werden zu „?“. */
export function alsAnsi(text: string) {
  const sonder: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97 };
  const b = Buffer.alloc(text.length);
  let i = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    b[i++] = sonder[ch] ?? (c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : 0x3f);
  }
  return b.subarray(0, i);
}

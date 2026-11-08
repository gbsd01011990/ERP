/**
 * Rechnungsbeträge. Reine Funktionen ohne Datenbank, damit Seite, PDF,
 * Festschreibung und Tests dieselben Zahlen liefern.
 *
 * Weg: Positionen netto (je Position auf Cent gerundet) → Leistung netto,
 * Umsatzsteuer, brutto → abzüglich verrechneter Vorrechnungen (je mit ihrer
 * eigenen Steuer) → Rechnungsbetrag → Einbehalt → Zahlbetrag → Skonto.
 */
import { n, runden, aufmassErgebnis, type AufmassWerte } from "../kalkulation";
import { formelBerechnen } from "./formel";

type Zahl = Parameters<typeof n>[0];

export type KostenartT = "LOHN" | "MASCHINE" | "FAHRT" | "MATERIAL" | "GEMISCHT";
export const KOSTENARTEN: { wert: KostenartT; text: string }[] = [
  { wert: "LOHN", text: "Lohn" },
  { wert: "MASCHINE", text: "Maschine" },
  { wert: "FAHRT", text: "Fahrt" },
  { wert: "MATERIAL", text: "Material" },
  { wert: "GEMISCHT", text: "gemischt" },
];

export type RPos = {
  art: "GRUPPE" | "POSITION" | "TEXT";
  ebene?: number;
  menge: Zahl;
  einzelpreis: Zahl;
  kostenart: KostenartT;
  lohnEp: Zahl;
};

export type VorRechnung = { netto: Zahl; mwst: Zahl; brutto: Zahl; einbehalt: Zahl; lohnBrutto: Zahl };

export type Kopf = {
  art: "RECHNUNG" | "ABSCHLAG" | "TEILSCHLUSS" | "SCHLUSS" | "KORREKTUR" | "STORNO";
  mwstSatz: Zahl;
  steuerschuldUmkehr: boolean;
  einbehaltProzent: Zahl;
  skontoProzent: Zahl;
};

/** Nach § 35a EStG begünstigter Anteil am Einzelpreis (Arbeit, Maschinen, Fahrt). */
export function beguenstigtJeEinheit(p: Pick<RPos, "kostenart" | "einzelpreis" | "lohnEp">) {
  const ep = n(p.einzelpreis);
  switch (p.kostenart) {
    case "LOHN": case "MASCHINE": case "FAHRT": return ep;
    case "MATERIAL": return 0;
    default: return ep >= 0 ? Math.min(Math.max(n(p.lohnEp), 0), ep) : Math.max(Math.min(n(p.lohnEp), 0), ep);
  }
}

export const positionGesamt = (p: Pick<RPos, "menge" | "einzelpreis">) => runden(n(p.menge) * n(p.einzelpreis));

/** Schlussrechnungen geben die in Abschlägen einbehaltenen Beträge wieder frei (sie sind in der Gesamtforderung enthalten). */
const loestEinbehalteAus = (art: Kopf["art"]) => art === "SCHLUSS" || art === "TEILSCHLUSS";

export function rechnungBerechnen(positionen: RPos[], kopf: Kopf, vorrechnungen: VorRechnung[] = []) {
  const satz = kopf.steuerschuldUmkehr ? 0 : n(kopf.mwstSatz);
  let netto = 0, lohnNetto = 0;
  const gruppen: number[] = [];
  const offen: { i: number; ebene: number }[] = [];
  const zeilen = positionen.map((p) => {
    if (p.art === "GRUPPE") {
      const ebene = p.ebene ?? 1;
      while (offen.length && offen[offen.length - 1].ebene >= ebene) offen.pop();
      gruppen.push(0);
      offen.push({ i: gruppen.length - 1, ebene });
      return { gesamt: 0 };
    }
    if (p.art !== "POSITION") return { gesamt: 0 };
    const gesamt = positionGesamt(p);
    netto += gesamt;
    lohnNetto += n(p.menge) * beguenstigtJeEinheit(p);
    for (const o of offen) gruppen[o.i] += gesamt;
    return { gesamt };
  });
  netto = runden(netto);
  const mwst = runden((netto * satz) / 100);
  const brutto = runden(netto + mwst);

  const abzugNetto = runden(vorrechnungen.reduce((s, v) => s + n(v.netto), 0));
  const abzugMwst = runden(vorrechnungen.reduce((s, v) => s + n(v.mwst), 0));
  const abzugBrutto = runden(vorrechnungen.reduce((s, v) => s + n(v.brutto), 0));
  const restNetto = runden(netto - abzugNetto);
  const restMwst = runden(mwst - abzugMwst);
  const restBrutto = runden(brutto - abzugBrutto);

  // Einbehalt: bei Abschlägen auf den Betrag dieser Rechnung, bei Schlussrechnungen auf die Gesamtleistung
  const basis = loestEinbehalteAus(kopf.art) ? brutto : restBrutto;
  const einbehalt = runden((basis * n(kopf.einbehaltProzent)) / 100);
  const freigabe = loestEinbehalteAus(kopf.art) ? runden(vorrechnungen.reduce((s, v) => s + n(v.einbehalt), 0)) : 0;
  const zahlbetrag = runden(restBrutto + freigabe - einbehalt);
  const skonto = zahlbetrag > 0 ? runden((zahlbetrag * n(kopf.skontoProzent)) / 100) : 0;

  const lohnGesamtBrutto = runden(lohnNetto * (1 + satz / 100));
  const lohnVorher = runden(vorrechnungen.reduce((s, v) => s + n(v.lohnBrutto), 0));
  const lohnBrutto = runden(lohnGesamtBrutto - lohnVorher);

  return {
    mwstSatz: satz,
    zeilen,
    gruppen: gruppen.map(runden),
    leistung: { netto, mwst, brutto },
    abzug: { netto: abzugNetto, mwst: abzugMwst, brutto: abzugBrutto },
    netto: restNetto,
    mwst: restMwst,
    brutto: restBrutto,
    einbehalt,
    einbehaltFreigabe: freigabe,
    zahlbetrag,
    skonto,
    lohnGesamtBrutto,
    lohnBrutto,
    lohnMwst: runden(lohnBrutto - lohnBrutto / (1 + satz / 100)),
  };
}

export type Berechnung = ReturnType<typeof rechnungBerechnen>;

export type RAufmass = AufmassWerte & { formel?: string | null };

/** Ergebnis einer Aufmaßzeile; eine Formel hat Vorrang vor den Faktoren. */
export function aufmassZeileWert(z: RAufmass) {
  if (z.formel?.trim()) {
    const v = formelBerechnen(z.formel);
    return z.abzug ? -v : v;
  }
  return aufmassErgebnis(z);
}

export const aufmassMenge = (zeilen: RAufmass[]) =>
  Math.round(zeilen.reduce((s, z) => s + aufmassZeileWert(z), 0) * 1000) / 1000;

/** Aus der Angebotskalkulation die Kostenart einer Position ableiten. */
export function kostenartAusKalkulation(anteile: { lohn: number; material: number; geraete: number; fremd: number }, ep: number) {
  const beguenstigt = runden(anteile.lohn + anteile.geraete);
  const rest = runden(anteile.material + anteile.fremd);
  if (beguenstigt <= 0) return { kostenart: "MATERIAL" as const, lohnEp: 0 };
  if (rest <= 0 && beguenstigt >= ep) return { kostenart: anteile.lohn > 0 ? ("LOHN" as const) : ("MASCHINE" as const), lohnEp: ep };
  return { kostenart: "GEMISCHT" as const, lohnEp: Math.min(beguenstigt, ep) };
}

/** Fälligkeit = Rechnungsdatum + Zahlungsziel. */
export const faelligAm = (datum: Date, tage: number) => new Date(datum.getTime() + tage * 864e5);

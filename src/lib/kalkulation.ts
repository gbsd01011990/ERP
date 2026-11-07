/**
 * Angebotskalkulation. Reine Funktionen ohne Datenbankzugriff, damit sie
 * in Seite, PDF und Tests dieselben Ergebnisse liefern.
 *
 * Einzelpreis = Lohn + Material + Geräte + Fremdleistung
 *   Lohn      = Minuten / 60 × Stundensatz
 *   Material  = Material-EK × (1 + Aufschlag %)
 *   Geräte    = Verrechnungspreis je Einheit (ohne Aufschlag)
 *   Fremd     = Fremd-EK × (1 + Aufschlag %)
 */

type Zahl = number | string | { toString(): string } | null | undefined;
export const n = (v: Zahl) => (v == null ? 0 : Number(v.toString()));
export const runden = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export type Saetze = { stundensatz: Zahl; materialAufschlag: Zahl; fremdAufschlag: Zahl };
export type KalkWerte = { minuten: Zahl; materialEk: Zahl; geraete: Zahl; fremdEk: Zahl };

export function einzelpreisAnteile(k: KalkWerte, s: Saetze) {
  const lohn = (n(k.minuten) / 60) * n(s.stundensatz);
  const material = n(k.materialEk) * (1 + n(s.materialAufschlag) / 100);
  const geraete = n(k.geraete);
  const fremd = n(k.fremdEk) * (1 + n(s.fremdAufschlag) / 100);
  return { lohn, material, geraete, fremd, summe: runden(lohn + material + geraete + fremd) };
}

export type Pos = KalkWerte & {
  art: "GRUPPE" | "POSITION" | "TEXT";
  menge: Zahl;
  einzelpreis: Zahl;
  preisFest: boolean;
  bedarf: boolean;
};

/** Wirksamer Einzelpreis: fester Preis oder kalkuliert. */
export const wirksamerEp = (p: Pos, s: Saetze) => (p.preisFest ? n(p.einzelpreis) : einzelpreisAnteile(p, s).summe);

/** Positionsnummern 01, 01.01, 01.02 … ; Positionen vor der ersten Gruppe zählen als 00.xx. */
export function nummerieren<T extends { art: string }>(positionen: T[]) {
  let g = 0, u = 0;
  return positionen.map((p) => {
    if (p.art === "GRUPPE") { g++; u = 0; return { ...p, posNr: String(g).padStart(2, "0") }; }
    if (p.art === "TEXT") return { ...p, posNr: "" };
    u++;
    return { ...p, posNr: `${String(g).padStart(2, "0")}.${String(u).padStart(2, "0")}` };
  });
}

/** Summen eines Angebots inklusive Lohnanteil (§ 35a EStG) und Stunden. */
export function summen(positionen: Pos[], s: Saetze & { mwstSatz: Zahl }) {
  let netto = 0, lohn = 0, minuten = 0, materialEk = 0, fremdEk = 0;
  const gruppen: { index: number; summe: number }[] = [];
  positionen.forEach((p, i) => {
    if (p.art === "GRUPPE") { gruppen.push({ index: i, summe: 0 }); return; }
    if (p.art !== "POSITION" || p.bedarf) return;
    const menge = n(p.menge);
    const gesamt = runden(wirksamerEp(p, s) * menge);
    netto += gesamt;
    if (gruppen.length) gruppen[gruppen.length - 1].summe += gesamt;
    const a = einzelpreisAnteile(p, s);
    // Bei festem Preis zählt der kalkulierte Lohn nur, solange er den Preis nicht übersteigt.
    lohn += Math.min(a.lohn, p.preisFest ? n(p.einzelpreis) : a.lohn) * menge;
    minuten += n(p.minuten) * menge;
    materialEk += n(p.materialEk) * menge;
    fremdEk += n(p.fremdEk) * menge;
  });
  netto = runden(netto);
  const mwst = runden((netto * n(s.mwstSatz)) / 100);
  return {
    netto,
    mwst,
    brutto: runden(netto + mwst),
    lohnanteilNetto: runden(lohn),
    lohnanteilBrutto: runden(lohn * (1 + n(s.mwstSatz) / 100)),
    stunden: Math.round((minuten / 60) * 10) / 10,
    materialEk: runden(materialEk),
    fremdEk: runden(fremdEk),
    gruppen: gruppen.map((g) => ({ ...g, summe: runden(g.summe) })),
  };
}

/** Deutsche Zahleneingabe "1.234,5" → 1234.5 */
export function parseZahl(v: FormDataEntryValue | null | undefined, fallback = 0) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return fallback;
  const x = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(x) ? x : fallback;
}

export type AufmassWerte = { anzahl: Zahl; laenge: Zahl; breite: Zahl; hoehe: Zahl; abzug: boolean };

/** Ergebnis einer Aufmaßzeile; leere Faktoren zählen als 1, Abzüge negativ. */
export function aufmassErgebnis(z: AufmassWerte) {
  const f = [z.anzahl, z.laenge, z.breite, z.hoehe].filter((v) => v != null && v !== "").map(n);
  const wert = f.length ? f.reduce((a, b) => a * b, 1) : 0;
  return Math.round((z.abzug ? -wert : wert) * 1000) / 1000;
}

export const aufmassSumme = (zeilen: AufmassWerte[]) =>
  Math.round(zeilen.reduce((s, z) => s + aufmassErgebnis(z), 0) * 1000) / 1000;

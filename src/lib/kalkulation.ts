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
  ebene?: number;
  menge: Zahl;
  einzelpreis: Zahl;
  preisFest: boolean;
  bedarf: boolean;
};

/** Wirksamer Einzelpreis: fester Preis oder kalkuliert. */
export const wirksamerEp = (p: Pos, s: Saetze) => (p.preisFest ? n(p.einzelpreis) : einzelpreisAnteile(p, s).summe);

/** Positionsnummern 01, 01.01, 01.02 … ; Positionen vor der ersten Gruppe zählen als 00.xx. Eine GAEB-OZ hat Vorrang. */
export function nummerieren<T extends { art: string; oz?: string | null }>(positionen: T[]) {
  let g = 0, u = 0;
  return positionen.map((p) => {
    if (p.art === "GRUPPE") { g++; u = 0; return { ...p, posNr: p.oz || String(g).padStart(2, "0") }; }
    if (p.art === "TEXT") return { ...p, posNr: "" };
    u++;
    return { ...p, posNr: p.oz || `${String(g).padStart(2, "0")}.${String(u).padStart(2, "0")}` };
  });
}

/** Summen eines Angebots inklusive Lohnanteil (§ 35a EStG) und Stunden. */
export function summen(positionen: Pos[], s: Saetze & { mwstSatz: Zahl }) {
  let netto = 0, lohn = 0, minuten = 0, materialEk = 0, fremdEk = 0, geraete = 0;
  const gruppen: { index: number; summe: number }[] = [];
  // Offene Titel als Stapel: eine Position zählt in ihren Titel und alle übergeordneten
  const offen: { gruppe: { index: number; summe: number }; ebene: number }[] = [];
  positionen.forEach((p, i) => {
    if (p.art === "GRUPPE") {
      const ebene = p.ebene ?? 1;
      while (offen.length && offen[offen.length - 1].ebene >= ebene) offen.pop();
      const gruppe = { index: i, summe: 0 };
      gruppen.push(gruppe);
      offen.push({ gruppe, ebene });
      return;
    }
    if (p.art !== "POSITION" || p.bedarf) return;
    const menge = n(p.menge);
    const gesamt = runden(wirksamerEp(p, s) * menge);
    netto += gesamt;
    for (const o of offen) o.gruppe.summe += gesamt;
    const a = einzelpreisAnteile(p, s);
    // Bei festem Preis zählt der kalkulierte Lohn nur, solange er den Preis nicht übersteigt.
    lohn += Math.min(a.lohn, p.preisFest ? n(p.einzelpreis) : a.lohn) * menge;
    minuten += n(p.minuten) * menge;
    materialEk += n(p.materialEk) * menge;
    fremdEk += n(p.fremdEk) * menge;
    geraete += n(p.geraete) * menge;
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
    geraete: runden(geraete),
    gruppen: gruppen.map((g) => ({ ...g, summe: runden(g.summe) })),
  };
}

/**
 * Deutsche Zahleneingabe: "1.234,5" → 1234.5, "1.700" → 1700, "12,5" → 12.5.
 * Ohne Komma gilt ein Punkt als Tausendertrenner, wenn danach genau drei Ziffern folgen
 * ("1.700", "200.000"); sonst als Dezimalpunkt ("12.5").
 */
export function parseZahl(v: FormDataEntryValue | null | undefined, fallback = 0) {
  const s = (typeof v === "string" ? v.trim() : "").replace(/[\s\u00a0€%]/g, "");
  if (!s) return fallback;
  let t: string;
  if (s.includes(",")) t = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) t = s.replace(/\./g, "");
  else t = s;
  const x = Number(t);
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

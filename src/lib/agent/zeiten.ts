/**
 * Bürozeiten, freie Termine und Rufnummern. Reine Funktionen (ohne Datenbank),
 * damit Agent-Werkzeuge, Einstellungsseite und Tests dasselbe rechnen.
 * Alle Zeiten in Berliner Ortszeit.
 */
import { berlinTag, berlinUhrzeit, berlinZuUtc, tagPlus } from "../zeit";

/** Wochentag 1 = Montag … 7 = Sonntag → [von, bis] als "HH:MM"; mehrere Fenster je Tag möglich. */
export type Wochenplan = Record<string, [string, string][]>;

export const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export const STANDARD_BUEROZEITEN: Wochenplan = {
  "1": [["07:00", "16:00"]], "2": [["07:00", "16:00"]], "3": [["07:00", "16:00"]], "4": [["07:00", "16:00"]], "5": [["07:00", "13:00"]],
};
export const STANDARD_TERMINZEITEN: Wochenplan = {
  "1": [["09:00", "15:00"]], "2": [["09:00", "15:00"]], "3": [["09:00", "15:00"]], "4": [["09:00", "15:00"]], "5": [["09:00", "12:00"]],
};

/** Wochentag eines Berliner Kalendertags (1 = Montag). */
export function wochentag(tag: string) {
  const [j, m, t] = tag.split("-").map(Number);
  const w = new Date(Date.UTC(j, m - 1, t)).getUTCDay();
  return w === 0 ? 7 : w;
}

const minuten = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "Mo 07:00–16:00, Fr 07:00–13:00" ⇄ Wochenplan. Tage: Mo Di Mi Do Fr Sa So, Bereiche wie "Mo-Do". */
export function planLesen(text: string): Wochenplan {
  const kurz = ["mo", "di", "mi", "do", "fr", "sa", "so"];
  const plan: Wochenplan = {};
  for (const teil of text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-zä]{2})(?:\s*[-–]\s*([a-zä]{2}))?\s+(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})$/i.exec(teil);
    if (!m) throw new Error(`Zeitangabe nicht verstanden: „${teil}“ (Beispiel: Mo-Do 07:00-16:00)`);
    const von = kurz.indexOf(m[1].toLowerCase()), bis = m[2] ? kurz.indexOf(m[2].toLowerCase()) : von;
    if (von < 0 || bis < 0 || bis < von) throw new Error(`Wochentag nicht verstanden: „${teil}“`);
    const a = m[3].replace(".", ":").padStart(5, "0"), e = m[4].replace(".", ":").padStart(5, "0");
    if (minuten(a) >= minuten(e)) throw new Error(`Ende vor Beginn: „${teil}“`);
    for (let d = von; d <= bis; d++) (plan[String(d + 1)] ??= []).push([a, e]);
  }
  return plan;
}

export function planText(plan: Wochenplan) {
  const kurz = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const zeilen: string[] = [];
  let i = 1;
  while (i <= 7) {
    const f = JSON.stringify(plan[String(i)] ?? []);
    let j = i;
    while (j < 7 && JSON.stringify(plan[String(j + 1)] ?? []) === f) j++;
    if (f !== "[]") for (const [a, e] of plan[String(i)]) zeilen.push(`${kurz[i - 1]}${j > i ? `-${kurz[j - 1]}` : ""} ${a}-${e}`);
    i = j + 1;
  }
  return zeilen.join(", ");
}

/** Ist jetzt (Berliner Zeit) innerhalb der Bürozeiten? */
export function istOffen(plan: Wochenplan, jetzt = new Date()) {
  const tag = berlinTag(jetzt);
  const m = minuten(berlinUhrzeit(jetzt));
  return (plan[String(wochentag(tag))] ?? []).some(([a, e]) => m >= minuten(a) && m < minuten(e));
}

export type Belegt = { beginn: Date; ende: Date };
export type Slot = { beginn: Date; ende: Date; text: string };

const TAGNAME = (tag: string) => WOCHENTAGE[wochentag(tag) - 1];
export const slotText = (beginn: Date) => {
  const tag = berlinTag(beginn);
  const [j, m, t] = tag.split("-");
  return `${TAGNAME(tag)}, ${t}.${m}.${j} um ${berlinUhrzeit(beginn)} Uhr`;
};

/**
 * Freie Termine: Zeitfenster laut Plan, im Raster der Termindauer, ab Vorlauf bis Horizont,
 * ohne Überschneidung mit belegten Terminen. Höchstens `anzahl`, je Tag höchstens `jeTag`
 * (damit der Agent verschiedene Tage anbieten kann).
 */
export function freieTermine(o: {
  plan: Wochenplan; dauerMin: number; vorlaufTage: number; tageVoraus: number; belegt: Belegt[];
  jetzt?: Date; abTag?: string; anzahl?: number; jeTag?: number;
}): Slot[] {
  const jetzt = o.jetzt ?? new Date();
  const heute = berlinTag(jetzt);
  const start = [tagPlus(heute, o.vorlaufTage), o.abTag ?? ""].sort().at(-1)!;
  const ende = tagPlus(heute, o.tageVoraus);
  const raus: Slot[] = [];
  for (let tag = start; tag <= ende && raus.length < (o.anzahl ?? 6); tag = tagPlus(tag, 1)) {
    let amTag = 0;
    for (const [a, e] of o.plan[String(wochentag(tag))] ?? []) {
      for (let m = minuten(a); m + o.dauerMin <= minuten(e); m += o.dauerMin) {
        const beginn = berlinZuUtc(tag, hhmm(m));
        const schluss = new Date(beginn.getTime() + o.dauerMin * 60000);
        if (beginn <= jetzt) continue;
        if (o.belegt.some((b) => b.beginn < schluss && b.ende > beginn)) continue;
        raus.push({ beginn, ende: schluss, text: slotText(beginn) });
        if (++amTag >= (o.jeTag ?? 2) || raus.length >= (o.anzahl ?? 6)) break;
      }
      if (amTag >= (o.jeTag ?? 2) || raus.length >= (o.anzahl ?? 6)) break;
    }
  }
  return raus;
}

/** Rufnummer vergleichbar machen: nur Ziffern, Ländervorwahl 49 und führende 0 entfernen. "+49 (0)3327 123" → "3327123". */
export function nummerSchluessel(nr: string | null | undefined) {
  let d = (nr ?? "").replace(/\(0\)/g, "").replace(/\D/g, "");
  if (d.startsWith("0049")) d = d.slice(4);
  else if (d.startsWith("49") && d.length > 10) d = d.slice(2);
  return d.replace(/^0+/, "");
}

/** Gleiche Nummer? Bei ausreichender Länge zählt der Schluss (Durchwahl-Varianten, fehlende Vorwahl). */
export function gleicheNummer(a: string | null | undefined, b: string | null | undefined) {
  const x = nummerSchluessel(a), y = nummerSchluessel(b);
  if (x.length < 6 || y.length < 6) return false;
  return x === y || (Math.min(x.length, y.length) >= 7 && (x.endsWith(y) || y.endsWith(x)));
}

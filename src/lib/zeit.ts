/**
 * Zeitrechnung in deutscher Ortszeit (Europe/Berlin), unabhängig von der Zeitzone des Servers.
 * Gespeichert wird immer UTC; Eingaben und Anzeigen laufen über diese Helfer.
 */
export const ZEITZONE = "Europe/Berlin";

const teile = (d: Date) => {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZEITZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => Number(f.find((p) => p.type === t)!.value);
  return { jahr: g("year"), monat: g("month"), tag: g("day"), stunde: g("hour"), minute: g("minute"), sekunde: g("second") };
};

/** Versatz Berlin gegenüber UTC in Minuten zum Zeitpunkt d (60 im Winter, 120 im Sommer). */
function versatzMinuten(d: Date) {
  const t = teile(d);
  return Math.round((Date.UTC(t.jahr, t.monat - 1, t.tag, t.stunde, t.minute, t.sekunde) - d.getTime()) / 60000);
}

/** "2026-11-08" + "07:30" (Berliner Ortszeit) → UTC-Zeitpunkt. */
export function berlinZuUtc(tag: string, uhrzeit = "00:00") {
  const [j, m, t] = tag.split("-").map(Number);
  const [h, min] = uhrzeit.split(":").map(Number);
  if (![j, m, t, h, min].every(Number.isFinite)) throw new Error(`Ungültige Zeitangabe: ${tag} ${uhrzeit}`);
  const alsUtc = Date.UTC(j, m - 1, t, h, min);
  // Zweimal annähern, damit Tage mit Zeitumstellung stimmen
  let d = new Date(alsUtc - versatzMinuten(new Date(alsUtc)) * 60000);
  d = new Date(alsUtc - versatzMinuten(d) * 60000);
  return d;
}

/** Kalendertag in Berlin als "YYYY-MM-DD". */
export function berlinTag(d: Date) {
  const t = teile(d);
  return `${t.jahr}-${String(t.monat).padStart(2, "0")}-${String(t.tag).padStart(2, "0")}`;
}

/** Uhrzeit in Berlin als "HH:MM". */
export function berlinUhrzeit(d: Date) {
  const t = teile(d);
  return `${String(t.stunde).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

/** Tag ± n Tage (rein kalendarisch). */
export function tagPlus(tag: string, n: number) {
  const [j, m, t] = tag.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + n));
  return d.toISOString().slice(0, 10);
}

/** Montag der Woche, in der der Tag liegt. */
export function wochenbeginn(tag: string) {
  const [j, m, t] = tag.split("-").map(Number);
  const wochentag = (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7; // Mo = 0
  return tagPlus(tag, -wochentag);
}

/** ISO-Kalenderwoche. */
export function kalenderwoche(tag: string) {
  const [j, m, t] = tag.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const erster = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - erster.getTime()) / 864e5 - 3 + ((erster.getUTCDay() + 6) % 7)) / 7);
}

export const minutenZwischen = (von: Date, bis: Date) => Math.round((bis.getTime() - von.getTime()) / 60000);

/** 125 → "2:05" */
export const stundenText = (minuten: number) => `${Math.floor(minuten / 60)}:${String(Math.abs(minuten % 60)).padStart(2, "0")}`;

export type TagesEintrag = { beginn: Date; ende: Date | null; kategorie: string };

/**
 * Hinweise nach Arbeitszeitgesetz für einen Tag:
 * mehr als 6 h Arbeit → mindestens 30 min Pause, mehr als 9 h → 45 min, mehr als 10 h → unzulässig.
 * Pausen sind Einträge der Kategorie PAUSE. Laufende Einträge zählen bis „jetzt“.
 */
export function arbeitszeitPruefen(eintraege: TagesEintrag[], jetzt = new Date()) {
  let arbeit = 0, pause = 0;
  for (const e of eintraege) {
    const min = minutenZwischen(e.beginn, e.ende ?? jetzt);
    if (e.kategorie === "PAUSE") pause += min; else arbeit += min;
  }
  const hinweise: string[] = [];
  if (arbeit > 600) hinweise.push(`Mehr als 10 Stunden Arbeitszeit (${stundenText(arbeit)} h).`);
  if (arbeit > 540 && pause < 45) hinweise.push(`Bei über 9 Stunden sind 45 Minuten Pause vorgeschrieben (erfasst: ${pause} min).`);
  else if (arbeit > 360 && pause < 30) hinweise.push(`Bei über 6 Stunden sind 30 Minuten Pause vorgeschrieben (erfasst: ${pause} min).`);
  return { arbeit, pause, hinweise };
}

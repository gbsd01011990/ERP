import { ZEITZONE } from "./zeit";

export const euro = (v: unknown) =>
  v == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(v));

// Immer deutsche Ortszeit, egal in welcher Zeitzone der Server läuft
export const datum = (d: Date | string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: ZEITZONE }).format(new Date(d));

export const datumZeit = (d: Date | string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: ZEITZONE }).format(new Date(d));

export const wochentagDatum = (d: Date | string) =>
  new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: ZEITZONE }).format(new Date(d));

type KontaktName = { firmenname?: string | null; vorname?: string | null; nachname?: string | null };
export const kontaktName = (k: KontaktName) =>
  k.firmenname?.trim() || [k.vorname, k.nachname].filter(Boolean).join(" ") || "(ohne Namen)";

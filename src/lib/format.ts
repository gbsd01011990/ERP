export const euro = (v: unknown) =>
  v == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(v));

export const datum = (d: Date | string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(d));

export const datumZeit = (d: Date | string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(d));

type KontaktName = { firmenname?: string | null; vorname?: string | null; nachname?: string | null };
export const kontaktName = (k: KontaktName) =>
  k.firmenname?.trim() || [k.vorname, k.nachname].filter(Boolean).join(" ") || "(ohne Namen)";

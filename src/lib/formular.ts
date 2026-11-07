/** Hilfen zum Auslesen von Formularfeldern in Server-Aktionen. */
import { parseZahl } from "./kalkulation";

export const text = (form: FormData, k: string) => {
  const v = form.get(k);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

/** Zahl oder null bei leerem Feld (deutsche Schreibweise erlaubt). */
export const zahlOderNull = (form: FormData, k: string) => (text(form, k) == null ? null : parseZahl(form.get(k)));
export const zahl = (form: FormData, k: string, fallback = 0) => parseZahl(form.get(k), fallback);
export const ganzzahl = (form: FormData, k: string) => {
  const z = zahlOderNull(form, k);
  return z == null ? null : Math.round(z);
};
/** Datum aus <input type="date">, 12:00 UTC, damit keine Zeitzone den Tag verschiebt. */
export const datumFeld = (form: FormData, k: string) => {
  const s = text(form, k);
  return s ? new Date(`${s}T12:00:00Z`) : null;
};
export const isoTag = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

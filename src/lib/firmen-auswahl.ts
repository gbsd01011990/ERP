import "server-only";
import type { AktuellerBenutzer } from "./auth";
import { firmenFilter } from "./firma";

/**
 * Für Seiten, die genau eine Firma brauchen (Lager, Geräte, Plankosten):
 * ?firma= aus der URL, sonst die oben gewählte Firma, sonst die erste erlaubte.
 */
export async function eineFirma(b: AktuellerBenutzer, wunsch?: string) {
  const { aktiv } = await firmenFilter(b);
  const firmen = b.zugriffe.map((z) => z.firma).sort((a, c) => a.name.localeCompare(c.name));
  const id = [wunsch, aktiv].find((x) => x && firmen.some((f) => f.id === x)) ?? firmen[0]?.id;
  return { firma: firmen.find((f) => f.id === id)!, firmen };
}

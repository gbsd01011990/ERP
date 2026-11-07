import "server-only";
import { cookies } from "next/headers";
import { firmenIds, type AktuellerBenutzer } from "./auth";

export const FIRMA_COOKIE = "erp_firma";

/**
 * Aktive Firmenauswahl: eine Firma oder "alle".
 * Liefert die Firmen-IDs, auf die Listen gefiltert werden.
 */
export async function firmenFilter(b: AktuellerBenutzer) {
  const erlaubt = firmenIds(b);
  const wahl = (await cookies()).get(FIRMA_COOKIE)?.value;
  if (wahl && erlaubt.includes(wahl)) return { aktiv: wahl, ids: [wahl] };
  return { aktiv: "alle" as const, ids: erlaubt };
}

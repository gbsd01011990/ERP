import "server-only";
import type { AktuellerBenutzer } from "./auth";

/**
 * Firmenfilter für Listen. Seit der Anmeldung je Mandant ist das immer genau
 * der angemeldete Mandant; die Form { aktiv, ids } bleibt für die Aufrufer gleich.
 */
export async function firmenFilter(b: AktuellerBenutzer) {
  return { aktiv: b.mandant.id, ids: [b.mandant.id] };
}

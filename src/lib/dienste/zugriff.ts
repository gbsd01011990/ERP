import type { Rolle } from "@prisma/client";
import { firmenIds, type AktuellerBenutzer } from "../auth";
import { FachFehler } from "./fehler";

export function firmaPruefen(b: AktuellerBenutzer, firmaId: string) {
  if (!firmenIds(b).includes(firmaId)) throw new FachFehler("Kein Zugriff auf diese Firma.", "KEIN_ZUGRIFF");
}

export function rollePruefen(b: AktuellerBenutzer, rollen: Rolle[] = ["ADMIN", "BUERO"]) {
  if (!rollen.includes(b.rolle)) throw new FachFehler("Für diese Aktion fehlt die Berechtigung.", "KEIN_ZUGRIFF");
}

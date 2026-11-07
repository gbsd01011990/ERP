import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Erzeugt einen Schlüssel. Der Klartext wird nur hier zurückgegeben. */
export async function schluesselAnlegen(benutzerId: string, name: string, nurLesen: boolean) {
  const klartext = `erp_${randomBytes(30).toString("base64url")}`;
  await db.apiSchluessel.create({ data: { benutzerId, name, nurLesen, hash: hash(klartext), anfang: klartext.slice(0, 10) } });
  return klartext;
}

/** Prüft einen Bearer-Schlüssel und liefert Benutzer (mit Firmenzugriffen) und Schreibrecht. */
export async function benutzerAusSchluessel(klartext: string) {
  if (!klartext.startsWith("erp_")) return null;
  const s = await db.apiSchluessel.findUnique({
    where: { hash: hash(klartext) },
    include: { benutzer: { include: { zugriffe: { include: { firma: true } } } } },
  });
  if (!s || s.widerrufenAm || !s.benutzer.aktiv) return null;
  // Nutzung höchstens minütlich festhalten, um Schreiblast zu sparen
  if (!s.letzteNutzung || Date.now() - s.letzteNutzung.getTime() > 60_000) {
    await db.apiSchluessel.update({ where: { id: s.id }, data: { letzteNutzung: new Date() } });
  }
  return { benutzer: s.benutzer, nurLesen: s.nurLesen };
}

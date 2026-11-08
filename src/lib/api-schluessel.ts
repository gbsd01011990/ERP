import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Erzeugt einen Schlüssel. Der Klartext wird nur hier zurückgegeben. */
export async function schluesselAnlegen(benutzerId: string, firmaId: string, name: string, nurLesen: boolean) {
  const klartext = `erp_${randomBytes(30).toString("base64url")}`;
  await db.apiSchluessel.create({ data: { benutzerId, firmaId, name, nurLesen, hash: hash(klartext), anfang: klartext.slice(0, 10) } });
  return klartext;
}

/** Prüft einen Bearer-Schlüssel und liefert Benutzer (auf den Mandanten des Schlüssels beschränkt) und Schreibrecht. */
export async function benutzerAusSchluessel(klartext: string) {
  if (!klartext.startsWith("erp_")) return null;
  const s = await db.apiSchluessel.findUnique({
    where: { hash: hash(klartext) },
    include: { benutzer: { include: { zugriffe: { include: { firma: true } } } } },
  });
  if (!s || s.widerrufenAm || !s.benutzer.aktiv || !s.firmaId) return null;
  // Wie bei der Anmeldung: nur der Mandant des Schlüssels, und nur solange der Benutzer dort Zugriff hat
  const zugriffe = s.benutzer.zugriffe.filter((z) => z.firmaId === s.firmaId);
  if (zugriffe.length === 0) return null;
  // Nutzung höchstens minütlich festhalten, um Schreiblast zu sparen
  if (!s.letzteNutzung || Date.now() - s.letzteNutzung.getTime() > 60_000) {
    await db.apiSchluessel.update({ where: { id: s.id }, data: { letzteNutzung: new Date() } });
  }
  return { benutzer: { ...s.benutzer, zugriffe, mandant: zugriffe[0].firma }, nurLesen: s.nurLesen };
}

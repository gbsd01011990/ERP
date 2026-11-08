import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Rolle } from "@prisma/client";
import { db } from "./db";
import { MANDANT_COOKIE, mandantNachSlug } from "./mandanten";

const COOKIE = "erp_sitzung";
const LAUFZEIT_TAGE = 30;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Meldet bei genau einem Mandanten an. Gelingt nur, wenn Passwort stimmt UND der Benutzer
 * Zugriff auf diese Firma hat. Die Fehlermeldung unterscheidet beides bewusst nicht.
 */
export async function anmelden(email: string, passwort: string, firmaId: string) {
  const b = await db.benutzer.findUnique({ where: { email: email.trim().toLowerCase() }, include: { zugriffe: true } });
  if (!b || !b.aktiv || !(await bcrypt.compare(passwort, b.passwortHash))) return false;
  if (!b.zugriffe.some((z) => z.firmaId === firmaId)) return false;
  const token = randomBytes(32).toString("base64url");
  const ablauf = new Date(Date.now() + LAUFZEIT_TAGE * 864e5);
  await db.sitzung.create({ data: { id: hash(token), benutzerId: b.id, firmaId, ablauf } });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: ablauf, path: "/" });
  return true;
}

export async function abmelden() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.sitzung.deleteMany({ where: { id: hash(token) } });
  jar.delete(COOKIE);
}

/**
 * Angemeldeter Benutzer im Mandanten der Sitzung. Die Firmenzugriffe sind auf diesen
 * einen Mandanten reduziert – alle Listen, Rechteprüfungen und die API sehen nur ihn.
 */
export async function aktuellerBenutzer() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await db.sitzung.findUnique({
    where: { id: hash(token) },
    include: { benutzer: { include: { zugriffe: { include: { firma: true } } } } },
  });
  if (!s || s.ablauf < new Date() || !s.benutzer.aktiv || !s.firmaId) return null;
  const zugriffe = s.benutzer.zugriffe.filter((z) => z.firmaId === s.firmaId);
  if (zugriffe.length === 0) return null; // Zugriff inzwischen entzogen
  return { ...s.benutzer, zugriffe, mandant: zugriffe[0].firma };
}

export const PASSWORT_MINDESTLAENGE = 12;

/** Ändert das eigene Passwort. Meldet alle anderen Sitzungen des Benutzers ab. Gibt einen Fehlertext zurück oder null. */
export async function passwortAendern(benutzerId: string, aktuell: string, neu: string, wiederholung: string) {
  if (neu.length < PASSWORT_MINDESTLAENGE) return `Das neue Passwort braucht mindestens ${PASSWORT_MINDESTLAENGE} Zeichen.`;
  if (neu !== wiederholung) return "Die beiden neuen Passwörter stimmen nicht überein.";
  if (neu === aktuell) return "Das neue Passwort muss sich vom bisherigen unterscheiden.";
  const b = await db.benutzer.findUnique({ where: { id: benutzerId } });
  if (!b || !(await bcrypt.compare(aktuell, b.passwortHash))) return "Das bisherige Passwort ist falsch.";
  await db.benutzer.update({ where: { id: b.id }, data: { passwortHash: await bcrypt.hash(neu, 12) } });
  const token = (await cookies()).get(COOKIE)?.value;
  await db.sitzung.deleteMany({ where: { benutzerId: b.id, ...(token ? { NOT: { id: hash(token) } } : {}) } });
  return null;
}

export type AktuellerBenutzer = NonNullable<Awaited<ReturnType<typeof aktuellerBenutzer>>>;

/** Erzwingt Anmeldung (und optional eine Mindestrolle). */
export async function benutzerPflicht(rollen?: Rolle[]) {
  const b = await aktuellerBenutzer();
  if (!b) redirect(await loginPfad());
  if (rollen && !rollen.includes(b.rolle)) redirect("/");
  return b;
}

/** IDs der Firmen, auf die der Benutzer zugreifen darf. */
export const firmenIds = (b: AktuellerBenutzer) => b.zugriffe.map((z) => z.firmaId);

/** Anmeldeseite des zuletzt genutzten Mandanten, sonst die Auswahl. */
export async function loginPfad() {
  const slug = (await cookies()).get(MANDANT_COOKIE)?.value;
  return slug && mandantNachSlug(slug) ? `/login/${slug}` : "/login";
}

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Rolle } from "@prisma/client";
import { db } from "./db";

const COOKIE = "erp_sitzung";
const LAUFZEIT_TAGE = 30;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function anmelden(email: string, passwort: string) {
  const b = await db.benutzer.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!b || !b.aktiv || !(await bcrypt.compare(passwort, b.passwortHash))) return false;
  const token = randomBytes(32).toString("base64url");
  const ablauf = new Date(Date.now() + LAUFZEIT_TAGE * 864e5);
  await db.sitzung.create({ data: { id: hash(token), benutzerId: b.id, ablauf } });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: ablauf, path: "/" });
  return true;
}

export async function abmelden() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.sitzung.deleteMany({ where: { id: hash(token) } });
  jar.delete(COOKIE);
}

export async function aktuellerBenutzer() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await db.sitzung.findUnique({
    where: { id: hash(token) },
    include: { benutzer: { include: { zugriffe: { include: { firma: true } } } } },
  });
  if (!s || s.ablauf < new Date() || !s.benutzer.aktiv) return null;
  return s.benutzer;
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

export type AktuellerBenutzer =NonNullable<Awaited<ReturnType<typeof aktuellerBenutzer>>>;

/** Erzwingt Anmeldung (und optional eine Mindestrolle). */
export async function benutzerPflicht(rollen?: Rolle[]) {
  const b = await aktuellerBenutzer();
  if (!b) redirect("/login");
  if (rollen && !rollen.includes(b.rolle)) redirect("/");
  return b;
}

/** IDs der Firmen, auf die der Benutzer zugreifen darf. */
export const firmenIds = (b: AktuellerBenutzer) => b.zugriffe.map((z) => z.firmaId);

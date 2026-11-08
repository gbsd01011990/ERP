"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { anmelden, abmelden, loginPfad } from "@/lib/auth";
import { db } from "@/lib/db";
import { MANDANT_COOKIE, mandantNachSlug } from "@/lib/mandanten";

export async function loginAktion(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "");
  const m = mandantNachSlug(String(form.get("mandant") ?? ""));
  const firma = m ? await db.firma.findUnique({ where: { kuerzel: m.kuerzel } }) : null;
  if (!m || !firma) return { fehler: "Unbekannter Mandant.", email };
  const ok = await anmelden(email, String(form.get("passwort") ?? ""), firma.id);
  if (!ok) return { fehler: `E-Mail oder Passwort falsch, oder kein Zugang zu ${m.name}.`, email };
  (await cookies()).set(MANDANT_COOKIE, m.slug, { path: "/", sameSite: "lax", maxAge: 365 * 86400 });
  redirect("/");
}

export async function logoutAktion() {
  await abmelden();
  redirect(await loginPfad());
}

/** Abmelden und zur Mandantenauswahl. */
export async function mandantWechseln() {
  await abmelden();
  redirect("/login?auswahl=1");
}

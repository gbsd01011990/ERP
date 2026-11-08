"use server";
import { benutzerPflicht, passwortAendern } from "@/lib/auth";

export async function passwortAendernAktion(_: unknown, form: FormData) {
  const b = await benutzerPflicht();
  const text = (k: string) => String(form.get(k) ?? "");
  const fehler = await passwortAendern(b.id, text("aktuell"), text("neu"), text("wiederholung"));
  return fehler ? { fehler } : { ok: true as const };
}

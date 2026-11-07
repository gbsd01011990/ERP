"use server";
import { redirect } from "next/navigation";
import { anmelden, abmelden } from "@/lib/auth";

export async function loginAktion(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "");
  const ok = await anmelden(email, String(form.get("passwort") ?? ""));
  if (!ok) return { fehler: "E-Mail oder Passwort falsch.", email };
  redirect("/");
}

export async function logoutAktion() {
  await abmelden();
  redirect("/login");
}

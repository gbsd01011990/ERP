"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { text } from "@/lib/formular";
import { benutzerSpeichern } from "@/lib/dienste/benutzer";
import { FachFehler } from "@/lib/dienste/fehler";

export async function benutzerAktion(_: unknown, form: FormData) {
  const b = await benutzerPflicht(["ADMIN"]);
  const id = text(form, "id");
  try {
    await benutzerSpeichern(b, id, {
      name: text(form, "name") ?? "",
      email: text(form, "email") ?? "",
      rolle: z.enum(["ADMIN", "BUERO", "KOLONNE"]).parse(form.get("rolle")),
      aktiv: form.get("aktiv") !== "aus",
      firmen: form.getAll("firmen").map(String),
      passwort: text(form, "passwort"),
    });
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof z.ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
    throw e;
  }
  revalidatePath("/einstellungen/benutzer");
  return { ok: id ? "Gespeichert." : "Benutzer angelegt.", zeit: Date.now() };
}

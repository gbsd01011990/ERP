"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { schluesselAnlegen } from "@/lib/api-schluessel";

export async function schluesselErstellen(_: unknown, form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { fehler: "Bitte einen Namen angeben, z. B. „Zapier“." };
  const klartext = await schluesselAnlegen(b.id, b.mandant.id, name, form.get("nurLesen") === "on");
  revalidatePath("/einstellungen/api");
  return { klartext, name };
}

export async function schluesselWiderrufen(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const id = String(form.get("id"));
  // Admins dürfen alle Schlüssel widerrufen, andere nur die eigenen
  await db.apiSchluessel.updateMany({
    where: { id, widerrufenAm: null, firmaId: b.mandant.id, ...(b.rolle === "ADMIN" ? {} : { benutzerId: b.id }) },
    data: { widerrufenAm: new Date() },
  });
  revalidatePath("/einstellungen/api");
}

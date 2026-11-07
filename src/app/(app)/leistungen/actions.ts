"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { parseZahl } from "@/lib/kalkulation";

const text = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

export async function leistungSpeichern(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const id = text(form.get("id"));
  const firmaId = String(form.get("firmaId"));
  if (!firmenIds(b).includes(firmaId)) throw new Error("Kein Zugriff.");
  const kurztext = text(form.get("kurztext"));
  const nummer = text(form.get("nummer"));
  if (!kurztext || !nummer) throw new Error("Nummer und Kurztext sind Pflicht.");
  const fp = text(form.get("festpreis"));
  const daten = {
    firmaId, nummer, kurztext,
    kategorie: text(form.get("kategorie")),
    langtext: text(form.get("langtext")),
    einheit: text(form.get("einheit")) ?? "Stk.",
    minuten: parseZahl(form.get("minuten")),
    materialEk: parseZahl(form.get("materialEk")),
    geraete: parseZahl(form.get("geraete")),
    fremdEk: parseZahl(form.get("fremdEk")),
    festpreis: fp ? parseZahl(fp) : null,
    aktiv: form.get("aktiv") !== "aus",
  };
  if (id) {
    const alt = await db.leistung.findUniqueOrThrow({ where: { id } });
    if (!firmenIds(b).includes(alt.firmaId)) throw new Error("Kein Zugriff.");
    await db.leistung.update({ where: { id }, data: daten });
  } else {
    await db.leistung.create({ data: daten });
  }
  revalidatePath("/leistungen");
}

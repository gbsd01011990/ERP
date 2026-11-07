"use server";
import { revalidatePath } from "next/cache";
import { benutzerPflicht } from "@/lib/auth";
import { parseZahl } from "@/lib/kalkulation";
import { leistungSpeichern as speichern } from "@/lib/dienste/leistungen";

const text = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

export async function leistungSpeichern(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const fp = text(form.get("festpreis"));
  await speichern(b, text(form.get("id")), {
    firmaId: String(form.get("firmaId")),
    nummer: text(form.get("nummer")) ?? "",
    kurztext: text(form.get("kurztext")) ?? "",
    kategorie: text(form.get("kategorie")),
    langtext: text(form.get("langtext")),
    einheit: text(form.get("einheit")),
    minuten: parseZahl(form.get("minuten")),
    materialEk: parseZahl(form.get("materialEk")),
    geraete: parseZahl(form.get("geraete")),
    fremdEk: parseZahl(form.get("fremdEk")),
    festpreis: fp ? parseZahl(fp) : null,
    aktiv: form.get("aktiv") !== "aus",
  });
  revalidatePath("/leistungen");
}

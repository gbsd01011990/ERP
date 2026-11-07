"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { text, zahl } from "@/lib/formular";
import { planAnlegen, planSpeichern, zeileSpeichern, zeileLoeschen, saetzeUebernehmen } from "@/lib/dienste/plankosten";

export async function planAnlegenAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN"]);
  const p = await planAnlegen(b, String(form.get("firmaId")), Math.round(zahl(form, "jahr", new Date().getFullYear())));
  redirect(`/plankosten/${p.id}`);
}

export async function planSpeichernAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN"]);
  const id = String(form.get("id"));
  await planSpeichern(b, id, {
    bezeichnung: text(form, "bezeichnung"),
    mitarbeiter: zahl(form, "mitarbeiter"), bezahlteStundenJahr: zahl(form, "bezahlteStundenJahr"),
    produktivProzent: zahl(form, "produktivProzent"), mittellohn: zahl(form, "mittellohn"),
    lohnnebenkostenProzent: zahl(form, "lohnnebenkostenProzent"), materialEinsatzJahr: zahl(form, "materialEinsatzJahr"),
    fremdEinsatzJahr: zahl(form, "fremdEinsatzJahr"), wagnisGewinnProzent: zahl(form, "wagnisGewinnProzent"),
  });
  revalidatePath(`/plankosten/${id}`);
}

export async function zeileSpeichernAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN"]);
  const planId = String(form.get("planId"));
  await zeileSpeichern(b, planId, text(form, "id"), {
    gruppe: text(form, "gruppe") ?? "Sonstiges",
    bezeichnung: text(form, "bezeichnung") ?? "",
    betragJahr: zahl(form, "betragJahr"),
    verteilung: z.enum(["LOHN", "MATERIAL", "FREMD"]).parse(form.get("verteilung") ?? "LOHN"),
  });
  revalidatePath(`/plankosten/${planId}`);
}

export async function zeileLoeschenAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN"]);
  const z0 = await zeileLoeschen(b, String(form.get("id")));
  revalidatePath(`/plankosten/${z0.planId}`);
}

export async function uebernehmenAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN"]);
  const id = String(form.get("id"));
  await saetzeUebernehmen(b, id);
  revalidatePath(`/plankosten/${id}`);
  revalidatePath("/leistungen");
}

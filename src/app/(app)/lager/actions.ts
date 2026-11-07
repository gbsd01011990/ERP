"use server";
import { revalidatePath } from "next/cache";
import { benutzerPflicht } from "@/lib/auth";
import { text, zahl, zahlOderNull } from "@/lib/formular";
import { lagerSpeichern, artikelSpeichern, buchen } from "@/lib/dienste/lager";
import { FachFehler } from "@/lib/dienste/fehler";
import { z } from "zod";

export async function lagerSpeichernAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  await lagerSpeichern(b, text(form, "id"), {
    firmaId: String(form.get("firmaId")),
    name: text(form, "name") ?? "",
    art: z.enum(["HAUPTLAGER", "AUSSENLAGER", "FAHRZEUG", "BAUSTELLE"]).parse(form.get("art")),
    adresse: text(form, "adresse"),
    aktiv: form.get("aktiv") !== "aus",
  });
  revalidatePath("/lager");
}

export async function artikelSpeichernAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  await artikelSpeichern(b, text(form, "id"), {
    firmaId: String(form.get("firmaId")),
    nummer: text(form, "nummer") ?? "",
    bezeichnung: text(form, "bezeichnung") ?? "",
    kategorie: text(form, "kategorie"),
    einheit: text(form, "einheit"),
    mindestbestand: zahlOderNull(form, "mindestbestand"),
    lieferant: text(form, "lieferant"),
    aktiv: form.get("aktiv") !== "aus",
  });
  revalidatePath("/lager");
}

/** Buchung mit Rückmeldung an das Formular (Fehler als Text statt Fehlerseite). */
export async function buchenAktion(_: unknown, form: FormData) {
  const b = await benutzerPflicht();
  try {
    await buchen(b, {
      art: z.enum(["ZUGANG", "ABGANG", "UMBUCHUNG", "PROJEKT", "INVENTUR"]).parse(form.get("art")),
      artikelId: String(form.get("artikelId") ?? ""),
      menge: zahl(form, "menge"),
      vonLagerId: text(form, "vonLagerId"),
      nachLagerId: text(form, "nachLagerId"),
      ekPreis: zahlOderNull(form, "ekPreis"),
      projektId: text(form, "projektId"),
      beleg: text(form, "beleg"),
      notiz: text(form, "notiz"),
    });
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    throw e;
  }
  revalidatePath("/lager", "layout");
  return { ok: "Gebucht.", zeit: Date.now() };
}

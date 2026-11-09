"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { parseZahl } from "@/lib/kalkulation";
import { kontaktSpeichern as kontaktSpeichernDienst } from "@/lib/dienste/kontakte";
import {
  projektAnlegen as projektAnlegenDienst,
  projektStatusSetzen as projektStatusSetzenDienst,
  logbuchEintragen as logbuchEintragenDienst,
} from "@/lib/dienste/projekte";

const leer = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

// ---------- Kontakte ----------

const feld = (form: FormData, k: string) => (typeof form.get(k) === "string" ? String(form.get(k)) : null);

export async function kontaktSpeichern(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const felder = ["firmenname", "anrede", "vorname", "nachname", "email", "telefon", "mobil", "leitwegId", "ustId", "notiz", "strasse", "plz", "ort"] as const;
  const eingabe = Object.fromEntries(felder.map((k) => [k, feld(form, k)]));
  const k = await kontaktSpeichernDienst(b, leer(form.get("id")), {
    ...eingabe,
    typ: z.enum(["KUNDE", "LIEFERANT", "PARTNER", "MITARBEITER"]).parse(form.get("typ")),
    kategorie: z.enum(["PRIVAT", "GEWERBE", "OEFFENTLICH"]).parse(form.get("kategorie")),
  });
  revalidatePath("/kontakte");
  redirect(`/kontakte/${k.id}`);
}

// ---------- Projekte ----------

export async function projektAnlegen(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const volumen = leer(form.get("volumen"));
  const p = await projektAnlegenDienst(b, {
    firmaId: String(form.get("firmaId")),
    kontaktId: String(form.get("kontaktId") ?? ""),
    titel: String(form.get("titel") ?? ""),
    typId: leer(form.get("typId")),
    quelle: leer(form.get("quelle")),
    beschreibung: leer(form.get("beschreibung")),
    volumen: volumen ? parseZahl(volumen) : null,
    baustelleStrasse: leer(form.get("baustelleStrasse")),
    baustellePlz: leer(form.get("baustellePlz")),
    baustelleOrt: leer(form.get("baustelleOrt")),
  });
  revalidatePath("/projekte");
  redirect(`/projekte/${p.id}`);
}

export async function projektStatusSetzen(form: FormData) {
  const b = await benutzerPflicht();
  const p = await projektStatusSetzenDienst(b, String(form.get("projektId")), String(form.get("statusId")));
  revalidatePath(`/projekte/${p.id}`);
  revalidatePath("/projekte");
}

export async function logbuchEintragen(form: FormData) {
  const b = await benutzerPflicht();
  const text = leer(form.get("text"));
  if (!text) return;
  const projektId = String(form.get("projektId"));
  await logbuchEintragenDienst(b, projektId, z.enum(["NOTIZ", "ANRUF", "EMAIL", "TERMIN"]).parse(form.get("art") ?? "NOTIZ"), text);
  revalidatePath(`/projekte/${projektId}`);
}

"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { FIRMA_COOKIE } from "@/lib/firma";
import { naechsteNummer } from "@/lib/nummern";

const leer = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

export async function firmaWaehlen(form: FormData) {
  const b = await benutzerPflicht();
  const wahl = String(form.get("firma") ?? "alle");
  const jar = await cookies();
  if (wahl !== "alle" && firmenIds(b).includes(wahl)) jar.set(FIRMA_COOKIE, wahl, { path: "/", sameSite: "lax" });
  else jar.delete(FIRMA_COOKIE);
  revalidatePath("/", "layout");
}

// ---------- Kontakte ----------

const KontaktSchema = z.object({
  typ: z.enum(["KUNDE", "LIEFERANT", "PARTNER"]),
  kategorie: z.enum(["PRIVAT", "GEWERBE", "OEFFENTLICH"]),
});

export async function kontaktSpeichern(form: FormData) {
  await benutzerPflicht(["ADMIN", "BUERO"]);
  const id = leer(form.get("id"));
  const { typ, kategorie } = KontaktSchema.parse({ typ: form.get("typ"), kategorie: form.get("kategorie") });
  const daten = {
    typ,
    kategorie,
    firmenname: leer(form.get("firmenname")),
    anrede: leer(form.get("anrede")),
    vorname: leer(form.get("vorname")),
    nachname: leer(form.get("nachname")),
    email: leer(form.get("email")),
    telefon: leer(form.get("telefon")),
    mobil: leer(form.get("mobil")),
    leitwegId: leer(form.get("leitwegId")),
    notiz: leer(form.get("notiz")),
  };
  if (!daten.firmenname && !daten.nachname) throw new Error("Firmenname oder Nachname angeben.");
  const adresse = {
    strasse: leer(form.get("strasse")),
    plz: leer(form.get("plz")),
    ort: leer(form.get("ort")),
  };

  let kontaktId = id;
  if (id) {
    await db.kontakt.update({ where: { id }, data: daten });
    const haupt = await db.adresse.findFirst({ where: { kontaktId: id, art: "HAUPT" } });
    if (haupt) await db.adresse.update({ where: { id: haupt.id }, data: adresse });
    else if (adresse.strasse || adresse.ort) await db.adresse.create({ data: { kontaktId: id, art: "HAUPT", ...adresse } });
  } else {
    const k = await db.kontakt.create({
      data: { ...daten, adressen: adresse.strasse || adresse.ort ? { create: { art: "HAUPT", ...adresse } } : undefined },
    });
    kontaktId = k.id;
  }
  revalidatePath("/kontakte");
  redirect(`/kontakte/${kontaktId}`);
}

// ---------- Projekte ----------

export async function projektAnlegen(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const firmaId = String(form.get("firmaId"));
  if (!firmenIds(b).includes(firmaId)) throw new Error("Kein Zugriff auf diese Firma.");
  const kontaktId = String(form.get("kontaktId") ?? "");
  const titel = leer(form.get("titel"));
  if (!kontaktId || !titel) throw new Error("Kunde und Titel sind Pflicht.");

  const ersterStatus = await db.pipelineStatus.findFirstOrThrow({ where: { firmaId }, orderBy: { reihenfolge: "asc" } });
  const volumen = leer(form.get("volumen"));

  const projekt = await db.$transaction(async (tx) => {
    const nummer = await naechsteNummer(tx, firmaId, "PROJEKT");
    return tx.projekt.create({
      data: {
        firmaId,
        nummer,
        titel,
        kontaktId,
        statusId: ersterStatus.id,
        typId: leer(form.get("typId")),
        quelle: leer(form.get("quelle")),
        beschreibung: leer(form.get("beschreibung")),
        volumen: volumen ? volumen.replace(/\./g, "").replace(",", ".") : null,
        baustelleStrasse: leer(form.get("baustelleStrasse")),
        baustellePlz: leer(form.get("baustellePlz")),
        baustelleOrt: leer(form.get("baustelleOrt")),
        verantwortlichId: b.id,
        logbuch: { create: { art: "SYSTEM", text: "Projekt angelegt", benutzerId: b.id } },
      },
    });
  });
  revalidatePath("/projekte");
  redirect(`/projekte/${projekt.id}`);
}

async function projektPruefen(projektId: string) {
  const b = await benutzerPflicht();
  const p = await db.projekt.findUniqueOrThrow({ where: { id: projektId } });
  if (!firmenIds(b).includes(p.firmaId)) throw new Error("Kein Zugriff.");
  return { b, p };
}

export async function projektStatusSetzen(form: FormData) {
  const { b, p } = await projektPruefen(String(form.get("projektId")));
  const status = await db.pipelineStatus.findUniqueOrThrow({ where: { id: String(form.get("statusId")) } });
  if (status.firmaId !== p.firmaId || status.id === p.statusId) return;
  await db.projekt.update({
    where: { id: p.id },
    data: {
      statusId: status.id,
      logbuch: { create: { art: "STATUS", text: `Status geändert: ${status.name}`, benutzerId: b.id } },
    },
  });
  revalidatePath(`/projekte/${p.id}`);
  revalidatePath("/projekte");
}

export async function logbuchEintragen(form: FormData) {
  const { b, p } = await projektPruefen(String(form.get("projektId")));
  const text = leer(form.get("text"));
  if (!text) return;
  const art = z.enum(["NOTIZ", "ANRUF", "EMAIL", "TERMIN"]).parse(form.get("art") ?? "NOTIZ");
  await db.logbuchEintrag.create({ data: { projektId: p.id, benutzerId: b.id, art, text } });
  revalidatePath(`/projekte/${p.id}`);
}

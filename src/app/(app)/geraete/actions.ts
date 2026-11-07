"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { text, zahl, zahlOderNull, ganzzahl, datumFeld } from "@/lib/formular";
import { geraetSpeichern, pruefungSpeichern, pruefungErledigt, ereignisErfassen, einsatzErfassen, einsatzLoeschen } from "@/lib/dienste/geraete";
import { FachFehler } from "@/lib/dienste/fehler";

const STATUS = z.enum(["VERFUEGBAR", "IM_EINSATZ", "WERKSTATT", "DEFEKT", "AUSGEMUSTERT"]);

export async function geraetSpeichernAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const g = await geraetSpeichern(b, text(form, "id"), {
    firmaId: String(form.get("firmaId")),
    inventarNr: text(form, "inventarNr") ?? "",
    bezeichnung: text(form, "bezeichnung") ?? "",
    kategorie: z.enum(["FAHRZEUG", "MASCHINE", "ANHAENGER", "KLEINGERAET", "WERKZEUG"]).parse(form.get("kategorie")),
    status: STATUS.parse(form.get("status") ?? "VERFUEGBAR"),
    hersteller: text(form, "hersteller"), modell: text(form, "modell"), seriennummer: text(form, "seriennummer"),
    kennzeichen: text(form, "kennzeichen"), baujahr: ganzzahl(form, "baujahr"), lagerId: text(form, "lagerId"),
    betriebsstunden: zahlOderNull(form, "betriebsstunden"), kmStand: ganzzahl(form, "kmStand"), notiz: text(form, "notiz"),
    anschaffungAm: datumFeld(form, "anschaffungAm"), anschaffungspreis: zahlOderNull(form, "anschaffungspreis"),
    nutzungsdauerJahre: ganzzahl(form, "nutzungsdauerJahre"), einsatzstundenJahr: ganzzahl(form, "einsatzstundenJahr"),
    zinsProzent: zahl(form, "zinsProzent", 5), reparaturProzent: zahl(form, "reparaturProzent", 8),
    fixkostenJahr: zahl(form, "fixkostenJahr"), betriebskostenStd: zahl(form, "betriebskostenStd"),
    verrechnungssatz: zahlOderNull(form, "verrechnungssatz"),
  });
  revalidatePath("/geraete");
  if (!text(form, "id")) redirect(`/geraete/${g.id}`);
  revalidatePath(`/geraete/${g.id}`);
}

export async function pruefungSpeichernAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const geraetId = String(form.get("geraetId"));
  await pruefungSpeichern(b, geraetId, text(form, "id"), {
    art: z.enum(["UVV", "HU", "AU", "WARTUNG", "INSPEKTION", "ELEKTROPRUEFUNG", "SONSTIGE"]).parse(form.get("art")),
    bezeichnung: text(form, "bezeichnung"),
    intervallMonate: ganzzahl(form, "intervallMonate"),
    letzteAm: datumFeld(form, "letzteAm"),
    naechsteAm: datumFeld(form, "naechsteAm"),
  });
  revalidatePath(`/geraete/${geraetId}`);
}

export async function pruefungErledigtAktion(form: FormData) {
  const b = await benutzerPflicht();
  await pruefungErledigt(b, String(form.get("id")), datumFeld(form, "am") ?? new Date(), text(form, "bemerkung"), zahlOderNull(form, "kosten"));
  revalidatePath(`/geraete/${form.get("geraetId")}`);
  revalidatePath("/geraete");
}

export async function ereignisAktion(form: FormData) {
  const b = await benutzerPflicht();
  const geraetId = String(form.get("geraetId"));
  const status = text(form, "status");
  await ereignisErfassen(b, geraetId, {
    art: z.enum(["PRUEFUNG", "WARTUNG", "REPARATUR", "SCHADEN", "NOTIZ"]).parse(form.get("art")),
    datum: datumFeld(form, "datum") ?? new Date(),
    text: text(form, "text") ?? "",
    kosten: zahlOderNull(form, "kosten"),
    betriebsstunden: zahlOderNull(form, "betriebsstunden"),
    status: status ? STATUS.parse(status) : null,
  });
  revalidatePath(`/geraete/${geraetId}`);
}

export async function einsatzAktion(_: unknown, form: FormData) {
  const b = await benutzerPflicht();
  const geraetId = String(form.get("geraetId"));
  try {
    await einsatzErfassen(b, geraetId, {
      projektId: String(form.get("projektId") ?? ""),
      datum: datumFeld(form, "datum") ?? new Date(),
      stunden: zahl(form, "stunden"),
      notiz: text(form, "notiz"),
    });
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    throw e;
  }
  revalidatePath(`/geraete/${geraetId}`);
  return { ok: "Einsatz erfasst.", zeit: Date.now() };
}

export async function einsatzLoeschenAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const e = await einsatzLoeschen(b, String(form.get("id")));
  revalidatePath(`/geraete/${e.geraetId}`);
  revalidatePath(`/projekte/${e.projektId}`);
}

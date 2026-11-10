"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { db } from "@/lib/db";
import { text } from "@/lib/formular";
import { FachFehler } from "@/lib/dienste/fehler";
import { MicrosoftFehler } from "@/lib/microsoft";
import {
  senden, emailZuordnen, emailIgnorieren, postfachAbrufen, meinePostfaecher, postfachSpeichern, postfachEntfernen, msZugangSpeichern,
} from "@/lib/dienste/mail";
import { anfrageAnlegen, aufgabeSpeichern, aufgabeErledigt, aufgabeVerschieben, kontaktNotiz } from "@/lib/dienste/crm";
import { ladeAngebot } from "@/lib/angebot";
import { belegDaten, pdfErzeugen } from "@/lib/pdf";
import { angebotVersendet } from "../angebote/actions";
import { bestellungLaden } from "@/lib/dienste/einkauf";
import { bestellungPdf } from "@/lib/einkauf/pdf";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;
const fehlerText = (e: unknown) =>
  e instanceof FachFehler || e instanceof MicrosoftFehler ? e.message : e instanceof z.ZodError ? e.issues.map((i) => i.message).join(" ") : null;

async function rueckmeldung(f: () => Promise<string>): Promise<Ergebnis> {
  try {
    return { ok: await f(), zeit: Date.now() };
  } catch (e) {
    const t = fehlerText(e);
    if (t) return { fehler: t, zeit: Date.now() };
    throw e;
  }
}

// ------------------------------------------------------------ Senden

export async function sendenAktion(_: unknown, form: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht();
  const angebotId = text(form, "angebotId");
  const projektId = text(form, "projektId");
  let ziel = "";
  const r = await rueckmeldung(async () => {
    const anhaenge: { name: string; typ: string; daten: Buffer }[] = [];
    if (angebotId && form.get("angebotAnhaengen") === "on") {
      const a = await ladeAngebot(angebotId, b);
      if (!a) throw new FachFehler("Angebot nicht gefunden.");
      const daten = belegDaten(a);
      anhaenge.push({ name: `${daten.dokumentart}_${daten.belegnummer}.pdf`, typ: "application/pdf", daten: await pdfErzeugen(daten) });
    }
    const bestellungId = text(form, "bestellungId");
    if (bestellungId && form.get("bestellungAnhaengen") === "on") {
      const x = await bestellungLaden(b, bestellungId);
      anhaenge.push({ name: `Bestellung_${x.nummer}.pdf`, typ: "application/pdf", daten: await bestellungPdf(x) });
    }
    for (const f of form.getAll("dateien")) {
      if (f instanceof File && f.size > 0) anhaenge.push({ name: f.name, typ: f.type || "application/octet-stream", daten: Buffer.from(await f.arrayBuffer()) });
    }
    const mail = await senden(b, {
      postfachId: String(form.get("postfachId") ?? ""), an: String(form.get("an") ?? ""), cc: text(form, "cc"),
      betreff: String(form.get("betreff") ?? ""), text: String(form.get("text") ?? ""), antwortAufId: text(form, "antwortAufId"),
      kontaktId: text(form, "kontaktId"), projektId, anhaenge,
    });
    // Angebot verschickt → wie „Als versendet markieren“ (Projektstatus rückt vor)
    if (angebotId && anhaenge.length) {
      const a = await db.angebot.findUnique({ where: { id: angebotId } });
      if (a?.status === "ENTWURF") {
        const fd = new FormData();
        fd.set("id", angebotId);
        await angebotVersendet(fd);
      }
    }
    ziel = mail.projektId ? `/projekte/${mail.projektId}` : "/posteingang?ansicht=gesendet";
    return "Gesendet.";
  });
  if (r?.ok) {
    revalidatePath("/", "layout");
    redirect(ziel);
  }
  return r;
}

// ------------------------------------------------------------ Posteingang

export async function zuordnenAktion(form: FormData) {
  const b = await benutzerPflicht();
  const id = String(form.get("id"));
  await emailZuordnen(b, id, text(form, "kontaktId"), text(form, "projektId"));
  revalidatePath(`/posteingang/${id}`);
  revalidatePath("/posteingang");
}

export async function ignorierenAktion(form: FormData) {
  const b = await benutzerPflicht();
  await emailIgnorieren(b, String(form.get("id")), form.get("wieder") !== "1");
  revalidatePath("/posteingang", "layout");
}

export async function abrufenAktion(_: unknown, __: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht();
  return rueckmeldung(async () => {
    let neu = 0;
    for (const p of await meinePostfaecher(b)) neu += (await postfachAbrufen(p.id)).neu;
    revalidatePath("/posteingang", "layout");
    return neu ? `${neu} neue E-Mail${neu === 1 ? "" : "s"}.` : "Keine neuen E-Mails.";
  });
}

// ------------------------------------------------------------ Anfragen

export async function anfrageAktion(_: unknown, form: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  let ziel = "";
  const r = await rueckmeldung(async () => {
    const felder = ["anrede", "vorname", "nachname", "firmenname", "email", "telefon", "strasse", "plz", "ort", "titel", "anliegen", "quelle", "wiedervorlageTag", "zustaendigId", "emailId"] as const;
    const e = Object.fromEntries(felder.map((k) => [k, text(form, k)]));
    const { projekt } = await anfrageAnlegen(b, { ...e, titel: e.titel ?? "" });
    ziel = `/projekte/${projekt.id}`;
    return "Angelegt.";
  });
  if (r?.ok) {
    revalidatePath("/", "layout");
    redirect(ziel);
  }
  return r;
}

// ------------------------------------------------------------ Aufgaben und Notizen

export async function aufgabeAktion(_: unknown, form: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht();
  return rueckmeldung(async () => {
    await aufgabeSpeichern(b, text(form, "id"), {
      titel: String(form.get("titel") ?? ""), notiz: text(form, "notiz"), faelligTag: text(form, "faelligTag"),
      zustaendigId: text(form, "zustaendigId"), kontaktId: text(form, "kontaktId"), projektId: text(form, "projektId"), emailId: text(form, "emailId"),
    });
    revalidatePath("/", "layout");
    return "Aufgabe gespeichert.";
  });
}

export async function erledigtAktion(form: FormData) {
  const b = await benutzerPflicht();
  await aufgabeErledigt(b, String(form.get("id")), form.get("wieder") !== "1");
  revalidatePath("/", "layout");
}

export async function verschiebenAktion(form: FormData) {
  const b = await benutzerPflicht();
  await aufgabeVerschieben(b, String(form.get("id")), Number(form.get("tage") ?? 1));
  revalidatePath("/", "layout");
}

export async function kontaktNotizAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const kontaktId = String(form.get("kontaktId"));
  await kontaktNotiz(b, kontaktId, z.enum(["NOTIZ", "ANRUF", "EMAIL", "TERMIN"]).parse(form.get("art") ?? "NOTIZ"), String(form.get("text") ?? ""));
  revalidatePath(`/kontakte/${kontaktId}`);
}

// ------------------------------------------------------------ Einstellungen (Admin)

export async function msZugangAktion(_: unknown, form: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return rueckmeldung(async () => {
    await msZugangSpeichern(b, { tenantId: String(form.get("tenantId") ?? ""), clientId: String(form.get("clientId") ?? ""), clientSecret: text(form, "clientSecret") });
    revalidatePath("/einstellungen/postfaecher");
    return "Verbindung zu Microsoft 365 geprüft und gespeichert.";
  });
}

export async function postfachAktion(_: unknown, form: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return rueckmeldung(async () => {
    const p = await postfachSpeichern(b, text(form, "id"), {
      art: z.enum(["PERSOENLICH", "GETEILT"]).parse(form.get("art")),
      adresse: String(form.get("adresse") ?? ""), name: text(form, "name"), benutzerId: text(form, "benutzerId"),
      zugriffe: form.getAll("zugriffe").map(String), rechnungseingang: form.get("rechnungseingang") === "on", lieferscheineingang: form.get("lieferscheineingang") === "on",
    });
    revalidatePath("/einstellungen/postfaecher");
    // Erster Abruf gleich im Anschluss, Fehler zeigt die Postfachliste
    postfachAbrufen(p.id).catch(() => {});
    return "Postfach gespeichert, erster Abruf läuft.";
  });
}

export async function postfachEntfernenAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN"]);
  await postfachEntfernen(b, String(form.get("id")));
  revalidatePath("/einstellungen/postfaecher");
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { text } from "@/lib/formular";
import { berlinZuUtc, tagPlus } from "@/lib/zeit";
import { FachFehler } from "@/lib/dienste/fehler";
import { KATEGORIEN, starten, stoppen, eintragSpeichern, eintragLoeschen, freigeben, freigabeAufheben } from "@/lib/dienste/zeiten";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;

/** Fachfehler als Rückmeldung ins Formular statt Fehlerseite. */
async function mitRueckmeldung(f: () => Promise<string>): Promise<Ergebnis> {
  try {
    const ok = await f();
    revalidatePath("/zeiten", "layout");
    return { ok, zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof z.ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
    throw e;
  }
}

const kategorie = (form: FormData) => z.enum(KATEGORIEN).parse(form.get("kategorie") ?? "UMSETZUNG");

export async function startenAktion(_: unknown, form: FormData) {
  const b = await benutzerPflicht();
  return mitRueckmeldung(async () => {
    await starten(b, { kategorie: kategorie(form), projektId: text(form, "projektId"), notiz: text(form, "notiz") });
    return "Stempeluhr läuft.";
  });
}

export async function stoppenAktion(_: unknown, __: FormData) {
  const b = await benutzerPflicht();
  return mitRueckmeldung(async () => {
    const r = await stoppen(b);
    return r.verworfen ? "Unter einer Minute – Eintrag verworfen." : "Ausgestempelt.";
  });
}

/** Eintrag von Hand: Datum + von/bis in Berliner Ortszeit. „bis“ vor „von“ = über Mitternacht. */
export async function eintragAktion(_: unknown, form: FormData) {
  const b = await benutzerPflicht();
  return mitRueckmeldung(async () => {
    const tag = text(form, "tag");
    const von = text(form, "von");
    const bis = text(form, "bis");
    if (!tag || !von || !bis) throw new FachFehler("Datum, von und bis sind Pflicht.");
    const beginn = berlinZuUtc(tag, von);
    const ende = berlinZuUtc(bis <= von ? tagPlus(tag, 1) : tag, bis);
    const id = text(form, "id");
    await eintragSpeichern(b, id, {
      benutzerId: text(form, "benutzerId") ?? b.id,
      kategorie: kategorie(form),
      projektId: text(form, "projektId"),
      beginn,
      ende,
      notiz: text(form, "notiz"),
    });
    return id ? "Gespeichert." : "Eingetragen.";
  });
}

export async function loeschenAktion(form: FormData) {
  const b = await benutzerPflicht();
  await eintragLoeschen(b, String(form.get("id")));
  revalidatePath("/zeiten", "layout");
}

/** Woche (Mo–So, Berliner Zeit) eines Mitarbeiters freigeben bzw. Freigabe aufheben. */
export async function freigabeAktion(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const woche = String(form.get("woche"));
  const von = berlinZuUtc(woche);
  const bis = berlinZuUtc(tagPlus(woche, 7));
  const benutzerId = String(form.get("benutzerId"));
  if (form.get("aufheben") === "1") await freigabeAufheben(b, benutzerId, von, bis);
  else await freigeben(b, benutzerId, von, bis);
  revalidatePath("/zeiten", "layout");
}

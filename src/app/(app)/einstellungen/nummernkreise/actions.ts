"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { zahl } from "@/lib/formular";
import { kreisSpeichern, zahlungsVorgabenSpeichern } from "@/lib/dienste/nummernkreise";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;

const fehler = (e: unknown): Ergebnis => {
  if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
  if (e instanceof ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
  throw e;
};

export async function kreisAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  try {
    const v = await kreisSpeichern(b, String(f.get("id")), {
      praefix: String(f.get("praefix") ?? ""),
      naechste: Math.round(zahl(f, "naechste", 1)),
      stellen: Math.round(zahl(f, "stellen", 3)),
      jahresweise: f.get("jahresweise") === "on",
    });
    revalidatePath("/einstellungen/nummernkreise");
    return { ok: `Gespeichert. Nächste Nummer: ${v}`, zeit: Date.now() };
  } catch (e) { return fehler(e); }
}

export async function zahlungAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  try {
    await zahlungsVorgabenSpeichern(b, {
      zahlungszielTage: Math.round(zahl(f, "zahlungszielTage", 14)),
      skontoProzent: zahl(f, "skontoProzent"),
      skontoTage: Math.round(zahl(f, "skontoTage")),
    });
    revalidatePath("/einstellungen/nummernkreise");
    return { ok: "Gespeichert. Gilt für neue Rechnungen.", zeit: Date.now() };
  } catch (e) { return fehler(e); }
}

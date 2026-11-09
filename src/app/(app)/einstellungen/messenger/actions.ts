"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { text } from "@/lib/formular";
import { zugangSpeichern, telegramVerbinden } from "@/lib/dienste/kanaele";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;
const FELDER = ["token", "zugriffstoken", "appGeheimnis", "verifyToken", "accountSid", "authToken"];

export async function zugangAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  try {
    const geheim: Record<string, string> = {};
    for (const k of FELDER) { const v = text(f, k); if (v) geheim[k] = v; }
    await zugangSpeichern(b, {
      kanal: String(f.get("kanal")) as "TELEGRAM", aktiv: f.get("aktiv") === "on",
      kennung: text(f, "kennung"), abwesenheit: text(f, "abwesenheit"), geheim,
    });
    revalidatePath("/einstellungen/messenger");
    return { ok: "Gespeichert.", zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
    throw e;
  }
}

export async function telegramAktion(_: unknown, _f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  const h = await headers();
  const basis = process.env.ERP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  try {
    await telegramVerbinden(b, basis);
    return { ok: "Telegram kennt jetzt die Adresse des ERP.", zeit: Date.now() };
  } catch (e) {
    return { fehler: e instanceof Error ? e.message : String(e), zeit: Date.now() };
  }
}

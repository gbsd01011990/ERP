"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { text } from "@/lib/formular";
import * as r from "@/lib/dienste/radar";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;
const id = (f: FormData) => String(f.get("id") ?? "");

async function melden(fn: () => Promise<string | void>): Promise<Ergebnis> {
  try {
    const ok = await fn();
    revalidatePath("/ausschreibungen");
    revalidatePath("/einstellungen/radar");
    return { ok: ok || "Gespeichert.", zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
    throw e;
  }
}

export async function statusAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const status = String(f.get("status"));
  if (!["NEU", "TEILNAHME", "AUSSORTIERT"].includes(status)) return { fehler: "Unbekannter Status.", zeit: Date.now() };
  const texte: Record<string, string> = { NEU: "Zurück in „Neu“ gelegt.", TEILNAHME: "Auf die Teilnahme-Liste gesetzt.", AUSSORTIERT: "Aussortiert." };
  return melden(async () => { await r.statusSetzen(b, id(f), status as "NEU", f.has("notiz") ? text(f, "notiz") : undefined); return texte[status]; });
}

export async function notizAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  return melden(async () => { await r.notizSetzen(b, id(f), text(f, "notiz")); return "Notiz gespeichert."; });
}

export async function projektAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  let ziel = "";
  const e = await melden(async () => { ziel = `/projekte/${(await r.alsProjekt(b, id(f))).id}`; });
  if (e?.fehler) return e;
  revalidatePath("/projekte");
  redirect(ziel);
}

const zahlFeld = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(",", "."));

export async function profilAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(() => r.profilSpeichern(b, {
    aktiv: f.get("aktiv") === "on",
    regionNuts: String(f.get("regionNuts") ?? ""), regionPlz: String(f.get("regionPlz") ?? ""), cpvPraefixe: String(f.get("cpvPraefixe") ?? ""),
    stichwoerter: String(f.get("stichwoerter") ?? ""), ausschluss: String(f.get("ausschluss") ?? ""),
    auftragsarten: f.getAll("auftragsarten").map(String) as ("works" | "services" | "supplies" | "")[],
    mindestScore: zahlFeld(f, "mindestScore"), scoreCpv: zahlFeld(f, "scoreCpv"), scoreTitel: zahlFeld(f, "scoreTitel"), scoreText: zahlFeld(f, "scoreText"),
  }).then(() => "Profil gespeichert. Es gilt ab dem nächsten Abruf."));
}

export async function laufAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(async () => { await r.laufAnstossen(b, zahlFeld(f, "tage")); return "Abruf gestartet. Das dauert ein bis drei Minuten; danach die Seite neu laden."; });
}

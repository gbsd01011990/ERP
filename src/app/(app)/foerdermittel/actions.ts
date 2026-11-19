"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { text } from "@/lib/formular";
import * as f from "@/lib/dienste/foerdermittel";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;
const id = (d: FormData) => String(d.get("id") ?? "");
const buero = () => benutzerPflicht(["ADMIN", "BUERO"]);

async function melden(fn: () => Promise<string | void>, ...pfade: string[]): Promise<Ergebnis> {
  try {
    const ok = await fn();
    for (const p of ["/foerdermittel", "/einstellungen/foerdermittel", ...pfade]) revalidatePath(p);
    return { ok: ok || "Gespeichert.", zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
    throw e;
  }
}

const TEXTE = { NEU: "Zurück in „Neu“ gelegt.", GEMERKT: "Gemerkt.", BEANTRAGT: "Als beantragt markiert.", AUSSORTIERT: "Aussortiert." } as const;

export async function statusAktion(_: unknown, d: FormData): Promise<Ergebnis> {
  const b = await buero();
  const status = String(d.get("status")) as keyof typeof TEXTE;
  if (!(status in TEXTE)) return { fehler: "Unbekannter Status.", zeit: Date.now() };
  return melden(async () => { await f.statusSetzen(b, id(d), status); return TEXTE[status]; });
}

export async function notizAktion(_: unknown, d: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => { await f.notizSetzen(b, id(d), text(d, "notiz")); return "Notiz gespeichert."; });
}

export async function projektAktion(_: unknown, d: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => { await f.projektSetzen(b, id(d), text(d, "projektId")); return text(d, "projektId") ? "Projekt zugeordnet." : "Zuordnung gelöst."; }, "/projekte");
}

export async function aufgabeAktion(_: unknown, d: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => `Aufgabe angelegt, fällig am ${(await f.aufgabeAnlegen(b, id(d))).split("-").reverse().join(".")}.`, "/aufgaben", "/");
}

const zahl = (d: FormData, k: string) => Number(String(d.get(k) ?? "").replace(",", "."));
const alle = <T extends string>(d: FormData, k: string) => d.getAll(k).map(String) as T[];

export async function profilAktion(_: unknown, d: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(async () => {
    const r = await f.profilSpeichern(b, {
      aktiv: d.get("aktiv") === "on", regionen: alle(d, "regionen"),
      stichwoerterBetrieb: String(d.get("stichwoerterBetrieb") ?? ""), stichwoerterKunde: String(d.get("stichwoerterKunde") ?? ""), ausschluss: String(d.get("ausschluss") ?? ""),
      bereicheBetrieb: alle(d, "bereicheBetrieb"), bereicheKunde: alle(d, "bereicheKunde"), berechtigteKunde: alle(d, "berechtigteKunde"),
      mindestScore: zahl(d, "mindestScore"), scoreTitel: zahl(d, "scoreTitel"), scoreText: zahl(d, "scoreText"), scoreBereich: zahl(d, "scoreBereich"),
    });
    return `Profil gespeichert und alle bekannten Programme neu bewertet: ${r.neu} neu, ${r.entfernt} unbearbeitete Treffer entfallen.`;
  });
}

export async function laufAktion(): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(async () => { await f.laufAnstossen(b); return "Abruf gestartet. Der erste Lauf dauert bis zu 15 Minuten, spätere wenige Minuten; danach die Seite neu laden."; });
}

"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { text, zahl, zahlOderNull } from "@/lib/formular";
import { pdfErzeugen } from "@/lib/pdf";
import * as d from "@/lib/dienste/zahlungen";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;
const buero = () => benutzerPflicht(["ADMIN", "BUERO"]);

async function melden(fn: () => Promise<string | void>, ...pfade: string[]): Promise<Ergebnis> {
  try {
    const ok = await fn();
    for (const p of ["/rechnungen/offene-posten", "/rechnungen", ...pfade]) revalidatePath(p);
    return { ok: ok || "Gespeichert.", zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
    throw e;
  }
}

export async function zahlungAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  const id = String(f.get("rechnungId"));
  return melden(async () => {
    await d.zahlungErfassen(b, id, { datum: String(f.get("datum")), betrag: zahl(f, "betrag"), art: String(f.get("art") ?? "UEBERWEISUNG") as "BAR", notiz: text(f, "notiz") });
    return "Zahlung erfasst.";
  }, `/rechnungen/${id}`);
}

export async function zahlungLoeschenAktion(f: FormData) {
  const b = await buero();
  await d.zahlungLoeschen(b, String(f.get("zahlungId")));
  revalidatePath(`/rechnungen/${String(f.get("rechnungId"))}`);
  revalidatePath("/rechnungen/offene-posten");
}

export async function mahnenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  const id = String(f.get("rechnungId"));
  return melden(async () => {
    const m = await d.mahnungErstellen(b, id, { zinsen: f.get("zinsen") === "on", pauschale: f.get("pauschale") === "on" }, (x) => pdfErzeugen(x as never));
    return `${m.stufe === 1 ? "Zahlungserinnerung" : m.stufe === 2 ? "1. Mahnung" : "2. Mahnung"} erstellt.`;
  }, `/rechnungen/${id}`);
}

export async function auszugAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => {
    const datei = f.get("datei");
    if (!(datei instanceof File) || datei.size === 0) throw new FachFehler("Bitte einen Kontoauszug (CAMT.053, XML) auswählen.");
    const r = await d.kontoauszugImportieren(b, datei.name, Buffer.from(await datei.arrayBuffer()));
    return `${r.gelesen} Umsätze gelesen, ${r.neu} neu${r.doppelt ? `, ${r.doppelt} schon vorhanden` : ""}.`;
  }, "/rechnungen/bank");
}

export async function zuordnenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => {
    const rechnungId = text(f, "rechnungId");
    if (!rechnungId) throw new FachFehler("Bitte eine Rechnung wählen.");
    await d.abgleichUebernehmen(b, String(f.get("umsatzId")), rechnungId, zahlOderNull(f, "skonto") ?? 0);
    return "Zugeordnet.";
  }, "/rechnungen/bank");
}

export async function uebergehenAktion(f: FormData) {
  const b = await buero();
  await d.umsatzUebergehen(b, String(f.get("umsatzId")));
  revalidatePath("/rechnungen/bank");
}

export async function buchhaltungAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  const s = (k: string) => String(f.get(k) ?? "").trim();
  return melden(() => d.buchhaltungSpeichern(b, {
    beraterNr: s("beraterNr"), mandantNr: s("mandantNr"), wjBeginnMonat: Math.round(zahl(f, "wjBeginnMonat", 1)), debitorStart: Math.round(zahl(f, "debitorStart", 10000)),
    kontoErloese19: s("kontoErloese19"), kontoErloese7: s("kontoErloese7"), kontoErloese13b: s("kontoErloese13b"), kontoErloeseFrei: s("kontoErloeseFrei"),
    kontoSkonto: s("kontoSkonto"), kontoBank: s("kontoBank"), kontoKasse: s("kontoKasse"), kontoAusbuchung: s("kontoAusbuchung"),
    mahnFristTage: Math.round(zahl(f, "mahnFristTage", 10)), gebuehrStufe2: zahl(f, "gebuehrStufe2"), gebuehrStufe3: zahl(f, "gebuehrStufe3"),
    basiszins: zahlOderNull(f, "basiszins"),
  }), "/einstellungen/buchhaltung");
}

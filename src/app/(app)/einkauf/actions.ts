"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { text, zahl, zahlOderNull } from "@/lib/formular";
import * as d from "@/lib/dienste/einkauf";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;
const alle = () => benutzerPflicht(["ADMIN", "BUERO", "KOLONNE"]);
const buero = () => benutzerPflicht(["ADMIN", "BUERO"]);
const id = (f: FormData, k = "id") => String(f.get(k) ?? "");

async function melden(fn: () => Promise<string | void>, ...pfade: string[]): Promise<Ergebnis> {
  try {
    const ok = await fn();
    for (const p of ["/einkauf", ...pfade]) revalidatePath(p);
    return { ok: ok || "Gespeichert.", zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
    throw e;
  }
}

const kopf = (f: FormData) => ({
  lieferantId: text(f, "lieferantId"), projektId: text(f, "projektId"), lagerId: text(f, "lagerId"),
  betreff: String(f.get("betreff") ?? ""), lieferadresse: text(f, "lieferadresse"), liefertermin: text(f, "liefertermin"), notiz: text(f, "notiz"),
});
const pos = (f: FormData) => ({ artikelId: text(f, "artikelId"), artNr: text(f, "artNr"), text: String(f.get("text") ?? ""), menge: zahl(f, "menge"), einheit: text(f, "einheit") ?? "Stk.", preis: zahl(f, "preis") });

// ---------------------------------------------------------------- Bestellungen
export async function bestellungNeuAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await alle();
  let ziel = "";
  const e = await melden(async () => {
    const angebotId = text(f, "angebotId");
    const x = angebotId ? await d.bestellungAusAngebot(b, angebotId, f.get("art") === "FREMD" ? "FREMD" : "MATERIAL") : await d.bestellungAnlegen(b, kopf(f));
    ziel = `/einkauf/bestellungen/${x.id}`;
  });
  if (e?.fehler) return e;
  redirect(ziel);
}
export async function bestellungKopfAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await alle();
  return melden(() => d.bestellungKopf(b, id(f), kopf(f)), `/einkauf/bestellungen/${id(f)}`);
}
export async function bestellPosNeuAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await alle();
  return melden(() => d.positionHinzufuegen(b, id(f), pos(f)), `/einkauf/bestellungen/${id(f)}`);
}
export async function bestellPosAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await alle();
  return melden(() => d.positionAendern(b, id(f, "posId"), f.get("loeschen") ? null : pos(f)), `/einkauf/bestellungen/${id(f)}`);
}
export async function bestellenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => `Bestellt unter Nummer ${(await d.bestellen(b, id(f))).nummer}.`, `/einkauf/bestellungen/${id(f)}`);
}
export async function bestellungStornoAktion(f: FormData) {
  const b = await buero();
  const x = await d.bestellungStornieren(b, id(f));
  revalidatePath("/einkauf");
  redirect(x ? `/einkauf/bestellungen/${x.id}` : "/einkauf");
}
export async function wareneingangAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await alle();
  const mengen: Record<string, number> = {};
  for (const [k] of f.entries()) if (k.startsWith("menge_")) mengen[k.slice(6)] = zahl(f, k);
  return melden(async () => {
    await d.wareneingangBuchen(b, id(f), { datum: String(f.get("datum")), lieferschein: text(f, "lieferschein"), notiz: text(f, "notiz"), mengen });
    return "Wareneingang gebucht.";
  }, `/einkauf/bestellungen/${id(f)}`, "/lager");
}
export async function vorschlagAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  const mengen: Record<string, number> = {};
  for (const [k] of f.entries()) if (k.startsWith("menge_")) mengen[k.slice(6)] = zahl(f, k);
  let ziel = "";
  const e = await melden(async () => {
    const lagerId = text(f, "lagerId");
    if (!lagerId) throw new FachFehler("Bitte das Ziellager wählen.");
    ziel = `/einkauf/bestellungen/${(await d.bestellungAusVorschlag(b, lagerId, mengen)).id}`;
  });
  if (e?.fehler) return e;
  redirect(ziel);
}

// ---------------------------------------------------------------- Eingangsrechnungen
export async function hochladenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  const dateien = f.getAll("datei").filter((x): x is File => x instanceof File && x.size > 0);
  if (!dateien.length) return { fehler: "Bitte eine oder mehrere Dateien wählen (XRechnung, ZUGFeRD-PDF oder PDF).", zeit: Date.now() };
  return melden(async () => {
    const ergebnisse: string[] = [];
    for (const x of dateien) {
      try {
        const r = await d.eingangErfassen(b.mandant.id, { name: x.name, daten: Buffer.from(await x.arrayBuffer()) }, "UPLOAD");
        ergebnisse.push(`${x.name}: ${r.format === "PDF" ? "PDF ohne E-Rechnung, Angaben bitte erfassen" : `${r.rechnungsnummer ?? "?"} gelesen`}`);
      } catch (e) {
        if (e instanceof FachFehler) ergebnisse.push(`${x.name}: ${e.message}`); else throw e;
      }
    }
    return ergebnisse.join(" · ");
  });
}
export async function eingangKopfAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => {
    await d.eingangBearbeiten(b, id(f), {
      lieferantId: text(f, "lieferantId"), rechnungsnummer: text(f, "rechnungsnummer"), datum: text(f, "datum"), faellig: text(f, "faellig"), leistungsdatum: text(f, "leistungsdatum"),
      netto: zahlOderNull(f, "netto"), mwst: zahlOderNull(f, "mwst"), brutto: zahlOderNull(f, "brutto"),
      bestellungId: text(f, "bestellungId"), projektId: text(f, "projektId"), kostenart: (text(f, "kostenart") ?? "MATERIAL") as "MATERIAL",
      skontoProzent: zahlOderNull(f, "skontoProzent"), skontoTage: zahlOderNull(f, "skontoTage") == null ? null : Math.round(zahl(f, "skontoTage")),
    });
    return "Gespeichert und neu geprüft.";
  }, `/einkauf/rechnungen/${id(f)}`);
}
export async function lieferantAnlegenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => `Lieferant ${(await d.lieferantAusRechnung(b, id(f))).firmenname} angelegt.`, `/einkauf/rechnungen/${id(f)}`);
}
export async function freigebenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => { await d.freigeben(b, id(f), text(f, "begruendung")); return "Zur Zahlung freigegeben."; }, `/einkauf/rechnungen/${id(f)}`);
}
export async function freigabeZurueckAktion(f: FormData) {
  const b = await buero();
  await d.freigabeZuruecknehmen(b, id(f));
  revalidatePath(`/einkauf/rechnungen/${id(f)}`);
}
export async function ablehnenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => { await d.ablehnen(b, id(f), String(f.get("grund") ?? "")); return "Abgelehnt."; }, `/einkauf/rechnungen/${id(f)}`);
}
export async function bezahltAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => { await d.alsBezahlt(b, id(f), String(f.get("datum")), zahl(f, "betrag")); return "Als bezahlt vermerkt."; }, `/einkauf/rechnungen/${id(f)}`);
}
export async function neuPruefenAktion(f: FormData) {
  const b = await buero();
  await d.eingangLaden(b, id(f));
  await d.pruefungAktualisieren(id(f));
  revalidatePath(`/einkauf/rechnungen/${id(f)}`);
}

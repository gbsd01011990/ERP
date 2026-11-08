"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { GaebFehler } from "@/lib/gaeb";
import { text, zahl, zahlOderNull } from "@/lib/formular";
import * as dienst from "@/lib/dienste/rechnungen";
import { rechnungPdf } from "@/lib/faktura/pdf";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;

const buero = () => benutzerPflicht(["ADMIN", "BUERO"]);
const id = (f: FormData, k = "id") => String(f.get(k) ?? "");
const an = (f: FormData, k: string) => f.get(k) === "on";

/** Fachliche Fehler als Rückmeldung, alles andere weiterwerfen. */
async function melden(fn: () => Promise<string | void>, pfad?: string): Promise<Ergebnis> {
  try {
    const ok = await fn();
    if (pfad) revalidatePath(pfad);
    return { ok: ok || "Gespeichert.", zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler || e instanceof GaebFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof ZodError) return { fehler: e.issues.map((i) => i.message).join(" "), zeit: Date.now() };
    throw e;
  }
}

export async function rechnungAnlegenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  let ziel = "";
  const e = await melden(async () => {
    const r = await dienst.rechnungAnlegen(b, {
      projektId: id(f, "projektId"),
      art: String(f.get("art")) as "RECHNUNG",
      angebotId: text(f, "angebotId"),
      modus: (text(f, "modus") as "AUFMASS" | "PLAN" | null) ?? null,
      planProzent: zahlOderNull(f, "planProzent"),
      bezugId: text(f, "bezugId"),
    });
    ziel = `/rechnungen/${r.id}`;
  });
  if (e?.fehler) return e;
  redirect(ziel);
}

export async function kopfAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(() => dienst.kopfSpeichern(b, id(f), {
    datum: String(f.get("datum")),
    leistungVon: text(f, "leistungVon"),
    leistungBis: text(f, "leistungBis"),
    betreff: String(f.get("betreff") ?? ""),
    anrede: text(f, "anrede"),
    einleitung: text(f, "einleitung"),
    schlusstext: text(f, "schlusstext"),
    kundenReferenz: text(f, "kundenReferenz"),
    mwstSatz: zahl(f, "mwstSatz", 19),
    steuerschuldUmkehr: an(f, "steuerschuldUmkehr"),
    s35a: an(f, "s35a"),
    zahlungszielTage: Math.round(zahl(f, "zahlungszielTage")),
    skontoProzent: zahl(f, "skontoProzent"),
    skontoTage: Math.round(zahl(f, "skontoTage")),
    einbehaltProzent: zahl(f, "einbehaltProzent"),
    aufmassAnhang: an(f, "aufmassAnhang"),
  }), `/rechnungen/${id(f)}`);
}

const positionAusForm = (f: FormData) => ({
  art: (text(f, "art") ?? "POSITION") as "POSITION",
  oz: text(f, "oz"),
  kurztext: String(f.get("kurztext") ?? ""),
  langtext: text(f, "langtext"),
  menge: zahl(f, "menge"),
  einheit: text(f, "einheit") ?? "Stk.",
  einzelpreis: zahl(f, "einzelpreis"),
  kostenart: (text(f, "kostenart") ?? "MATERIAL") as "MATERIAL",
  lohnEp: zahl(f, "lohnEp"),
});

export async function positionNeuAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(() => dienst.positionHinzufuegen(b, id(f), positionAusForm(f)), `/rechnungen/${id(f)}`);
}

export async function positionAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  if (f.get("loeschen")) return melden(() => dienst.positionLoeschen(b, id(f, "positionId")).then(() => "Gelöscht."), `/rechnungen/${id(f)}`);
  return melden(() => dienst.positionAendern(b, id(f, "positionId"), positionAusForm(f)), `/rechnungen/${id(f)}`);
}

export async function aufmassAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(() => dienst.aufmassHinzufuegen(b, id(f, "positionId"), {
    datum: text(f, "datum"),
    text: text(f, "text"),
    formel: text(f, "formel"),
    anzahl: zahlOderNull(f, "anzahl"),
    laenge: zahlOderNull(f, "laenge"),
    breite: zahlOderNull(f, "breite"),
    hoehe: zahlOderNull(f, "hoehe"),
    abzug: an(f, "abzug"),
  }).then(() => "Aufmaßzeile übernommen."), `/rechnungen/${id(f)}`);
}

export async function aufmassLoeschenAktion(f: FormData) {
  const b = await buero();
  await dienst.aufmassLoeschen(b, id(f, "zeileId"));
  revalidatePath(`/rechnungen/${id(f)}`);
}

export async function verrechnungAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(() => dienst.verrechnungenSetzen(b, id(f), f.getAll("vorId").map(String)), `/rechnungen/${id(f)}`);
}

export async function x31Aktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => {
    const d = f.get("datei");
    if (!(d instanceof File) || d.size === 0) throw new FachFehler("Bitte eine GAEB-Datei (X31) auswählen.");
    const r = await dienst.mengenAusX31(b, id(f), d.name, Buffer.from(await d.arrayBuffer()));
    return `${r.uebernommen} Mengen übernommen.${r.unbekannt.length ? ` Ohne passende Ordnungszahl: ${r.unbekannt.slice(0, 10).join(", ")}` : ""}`;
  }, `/rechnungen/${id(f)}`);
}

export async function festschreibenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  return melden(async () => {
    const r = await dienst.festschreiben(b, id(f), rechnungPdf);
    revalidatePath("/rechnungen");
    return `Festgeschrieben als ${r.nummer}.`;
  }, `/rechnungen/${id(f)}`);
}

export async function stornoAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await buero();
  let ziel = "";
  const e = await melden(async () => {
    if (!an(f, "bestaetigt")) throw new FachFehler("Bitte das Storno bestätigen.");
    const s = await dienst.stornieren(b, id(f), rechnungPdf);
    ziel = `/rechnungen/${s.id}`;
  });
  if (e?.fehler) return e;
  revalidatePath("/rechnungen");
  redirect(ziel);
}

export async function entwurfLoeschenAktion(f: FormData) {
  const b = await buero();
  const r = await dienst.entwurfLoeschen(b, id(f));
  redirect(`/projekte/${r.projektId}`);
}

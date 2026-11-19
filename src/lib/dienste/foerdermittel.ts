/**
 * Fördermittel-Radar: Förderprogramme aus der Förderdatenbank des Bundes (Bund, Berlin, Brandenburg),
 * je Firma bewertet nach zwei Blickwinkeln:
 *  - Betrieb: Geld für die eigene Firma (Digitalisierung, Weiterbildung, Fahrzeuge, Energie …)
 *  - Kunde:   Geld, das Kunden für Garten- und Landschaftsbau bekommen (Begrünung, Entsiegelung,
 *             Klimaanpassung, Bäume …) – Verkaufsargument und Hinweis auf kommende Aufträge.
 * Abruf und Bewertung: radar/foerder_erp.py.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { FoerderProfil, FoerderStatus, Prisma } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { berlinTag, berlinZuUtc, tagPlus } from "../zeit";
import { FachFehler } from "./fehler";
import { rollePruefen } from "./zugriff";

// ------------------------------------------------------------------ Profile

export const REGIONEN = ["bundesweit", "Berlin", "Brandenburg"] as const;
export const BEREICHE = [
  "Arbeit", "Aus- & Weiterbildung", "Beratung", "Digitalisierung", "Energieeffizienz & Erneuerbare Energien", "Existenzgründung & -festigung",
  "Infrastruktur", "Landwirtschaft & Ländliche Entwicklung", "Mobilität", "Regionalförderung", "Smart Cities & Regionen", "Städtebau & Stadterneuerung",
  "Umwelt- & Naturschutz", "Unternehmensfinanzierung", "Wohnungsbau & Modernisierung",
] as const;
export const BERECHTIGTE = ["Privatperson", "Kommune", "Öffentliche Einrichtung", "Verband/Vereinigung", "Unternehmen", "Bildungseinrichtung"] as const;

const BETRIEB = {
  stichwoerterBetrieb: [
    "digitalisierung", "digital", "software", "weiterbildung", "fortbildung", "qualifizierung", "ausbildung", "fachkräfte", "fachkräftesicherung",
    "energieeffizien", "elektrofahrzeug", "elektromobilität", "e-mobilität", "nutzfahrzeug", "lastenrad", "ladeinfrastruktur", "photovoltaik",
    "unternehmensberatung", "beratungsförderung", "innovationsgutschein", "gartenbau", "handwerk", "arbeitsschutz", "gesundheitsmanagement",
  ],
  bereicheBetrieb: ["Digitalisierung", "Aus- & Weiterbildung", "Energieeffizienz & Erneuerbare Energien", "Mobilität", "Beratung", "Arbeit"],
};
const KUNDE_ALLGEMEIN = {
  bereicheKunde: ["Umwelt- & Naturschutz", "Städtebau & Stadterneuerung", "Landwirtschaft & Ländliche Entwicklung", "Infrastruktur", "Wohnungsbau & Modernisierung", "Smart Cities & Regionen"],
  berechtigteKunde: ["Privatperson", "Kommune", "Öffentliche Einrichtung", "Verband/Vereinigung", "Unternehmen"],
  ausschluss: ["film", "forschung", "export", "messe", "hochschul", "krankenhaus", "schiff", "luftfahrt", "kultur", "fischerei", "tierhaltung", "rundfunk"],
  regionen: [...REGIONEN],
};
const GALABAU = {
  ...BETRIEB, ...KUNDE_ALLGEMEIN,
  stichwoerterKunde: [
    "dachbegrünung", "fassadenbegrünung", "gebäudegrün", "begrünung", "entsiegelung", "regenwasser", "versickerung", "schwammstadt", "stadtgrün",
    "grünfläche", "grünanlage", "klimaanpassung", "hitzeschutz", "stadtbäume", "baumpflanz", "biodiversität", "artenvielfalt", "insekten",
    "blühfläche", "naturnah", "landschaftspflege", "streuobst", "hecke", "gehölz", "spielplatz", "schulhof", "freifläche", "freiraum",
    "wohnumfeld", "kleingarten", "friedhof", "parkanlage", "allee", "renaturierung",
  ],
};
const BAUMDIENST = {
  ...BETRIEB, ...KUNDE_ALLGEMEIN,
  stichwoerterKunde: [
    "bäume", "baumpflege", "baumpflanz", "baumschutz", "baumbestand", "stadtbäume", "straßenbäume", "allee", "gehölz", "hecke", "streuobst",
    "wald", "forst", "biodiversität", "klimaanpassung", "totholz", "verkehrssicherung", "naturdenkmal", "landschaftspflege",
  ],
};
export const STANDARD_PROFIL: Record<string, typeof GALABAU> = { RD: GALABAU, GBSD: GALABAU, KUD: BAUMDIENST };

export async function profilFuer(firmaId: string) {
  const p = await db.foerderProfil.findUnique({ where: { firmaId } });
  if (p) return p;
  const f = await db.firma.findUniqueOrThrow({ where: { id: firmaId } });
  return db.foerderProfil.create({ data: { firmaId, ...(STANDARD_PROFIL[f.kuerzel] ?? GALABAU) } });
}

const klein = (l: string[]) => l.map((x) => x.toLowerCase());
const alsConfig = (p: FoerderProfil) => ({
  regionen: p.regionen, stichwoerter_betrieb: klein(p.stichwoerterBetrieb), stichwoerter_kunde: klein(p.stichwoerterKunde),
  bereiche_betrieb: p.bereicheBetrieb, bereiche_kunde: p.bereicheKunde, berechtigte_betrieb: ["Unternehmen"], berechtigte_kunde: p.berechtigteKunde,
  ausschluss: klein(p.ausschluss), mindest_score: p.mindestScore, score_titel: p.scoreTitel, score_text: p.scoreText, score_bereich: p.scoreBereich,
});

const liste = z.string().transform((s) => [...new Set(s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))]);
const auswahl = <T extends readonly [string, ...string[]]>(werte: T) => z.array(z.enum(werte));
export const ProfilEingabe = z.object({
  aktiv: z.boolean(),
  regionen: auswahl(REGIONEN).min(1, "Bitte mindestens ein Fördergebiet wählen."),
  stichwoerterBetrieb: liste, stichwoerterKunde: liste, ausschluss: liste,
  bereicheBetrieb: auswahl(BEREICHE), bereicheKunde: auswahl(BEREICHE), berechtigteKunde: auswahl(BERECHTIGTE),
  mindestScore: z.number().int().min(1).max(20), scoreTitel: z.number().int().min(0).max(10), scoreText: z.number().int().min(0).max(10), scoreBereich: z.number().int().min(0).max(10),
});

export async function profilSpeichern(b: AktuellerBenutzer, eingabe: z.input<typeof ProfilEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  const e = ProfilEingabe.parse(eingabe);
  if (!e.stichwoerterBetrieb.length && !e.stichwoerterKunde.length) throw new FachFehler("Ohne Stichwörter findet das Radar nichts.");
  await profilFuer(b.mandant.id);
  await db.foerderProfil.update({ where: { firmaId: b.mandant.id }, data: e });
  return bewertenAlle();
}

// ------------------------------------------------------------------ Python

function python<T>(eingabe: object): Promise<T & { log: string[] }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.PYTHON ?? "python3", ["-I", path.join(process.cwd(), "radar", "foerder_erp.py")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => {
      try { const j = JSON.parse(out); if (code === 2) j.log.push("FEHLER: Förderdatenbank nicht erreichbar."); resolve(j); } catch { reject(new Error(`Fördermittel-Radar ohne Antwort (Exit ${code}): ${err.slice(-800)}`)); }
    });
    p.stdin.end(JSON.stringify(eingabe));
  });
}

type Detail = {
  titel: string; foerderart?: string[]; bereiche?: string[]; gebiete?: string[]; berechtigte?: string[]; foerdergeber?: string;
  kontakt?: Record<string, string>; links?: string[]; kurztext: string; volltext: string; zusatzinfos: string; rechtsgrundlage: string; fristen: string[];
};
type Abruf = { programme: { url: string; titel: string; berechtigte: string[]; bereiche: string[]; gebiete: string[]; detail?: Detail }[]; vollstaendig: string[] };
type Bewertung = { ergebnisse: { url: string; profile: { id: string; punkte: number; zielgruppen: string[]; gruende: string[] }[] }[] };

const aktiveProfile = async () =>
  (await Promise.all((await db.firma.findMany({ select: { id: true } })).map((f) => profilFuer(f.id)))).filter((p) => p.aktiv);

/** Alle laufenden Programme gegen alle aktiven Profile; legt neue Treffer an, räumt unberührte weg. */
export async function bewertenAlle() {
  const profile = await aktiveProfile();
  const programme = await db.foerderprogramm.findMany({
    where: { beendetAm: null },
    select: { id: true, url: true, titel: true, kurztext: true, volltext: true, berechtigte: true, bereiche: true, gebiete: true },
  });
  const r = await python<Bewertung>({ modus: "bewerten", profile: profile.map((p) => ({ id: p.firmaId, config: alsConfig(p) })), programme });
  const nachUrl = new Map(programme.map((p) => [p.url, p.id]));
  const vorhanden = new Map((await db.foerderTreffer.findMany({ select: { id: true, programmId: true, firmaId: true, status: true } })).map((t) => [`${t.programmId}|${t.firmaId}`, t]));
  const gueltig = new Set<string>();
  let neu = 0;
  for (const e of r.ergebnisse) {
    const programmId = nachUrl.get(e.url);
    if (!programmId) continue;
    for (const p of e.profile) {
      const schluessel = `${programmId}|${p.id}`;
      gueltig.add(schluessel);
      const t = vorhanden.get(schluessel);
      const daten = { punkte: p.punkte, zielgruppen: p.zielgruppen, gruende: p.gruende };
      if (t) await db.foerderTreffer.update({ where: { id: t.id }, data: daten });
      else { await db.foerderTreffer.create({ data: { programmId, firmaId: p.id, ...daten } }); neu++; }
    }
  }
  // Passt nach einer Profiländerung nicht mehr und wurde noch nicht angefasst: weg damit
  const aktivIds = new Set(profile.map((p) => p.firmaId));
  const laufend = new Set(nachUrl.values());
  const weg = [...vorhanden.entries()].filter(([k, t]) => t.status === "NEU" && !gueltig.has(k) && laufend.has(t.programmId) && aktivIds.has(t.firmaId)).map(([, t]) => t.id);
  if (weg.length) await db.foerderTreffer.deleteMany({ where: { id: { in: weg }, status: "NEU", notiz: null, projektId: null } });
  return { neu, entfernt: weg.length };
}

// ------------------------------------------------------------------ Lauf

/**
 * Ein Lauf: Ergebnislisten für Bund, Berlin und Brandenburg, Einzelseiten für neue bzw. ältere
 * Kandidaten (höchstens detailsMax), danach Bewertung für alle Firmen. Programme, die in einer
 * vollständig gelesenen Liste fehlen, gelten als beendet.
 */
export async function foerderLaufen(o: { detailsMax?: number } = {}) {
  const lauf = await db.foerderLauf.create({ data: {} });
  try {
    const profile = await aktiveProfile();
    if (!profile.length) throw new Error("Kein aktives Fördermittel-Profil.");
    const regionen = [...new Set(profile.flatMap((p) => p.regionen))];
    const code = (r: string) => (r === "bundesweit" ? "_bundesweit" : r.toLowerCase());
    const aktuell = (await db.foerderprogramm.findMany({ where: { detailAm: { gte: new Date(Date.now() - 30 * 864e5) } }, select: { url: true } })).map((p) => p.url);
    const r = await python<Abruf>({
      modus: "abruf", regionen: regionen.map(code), profile: profile.map((p) => ({ id: p.firmaId, config: alsConfig(p) })), aktuell,
      details_max: o.detailsMax ?? Number(process.env.FOERDER_DETAILS_MAX ?? 120), pause: Number(process.env.FOERDER_PAUSE ?? 1.5),
    });
    const jetzt = new Date();
    let details = 0;
    for (const p of r.programme) {
      const d = p.detail;
      const basis = { titel: (d?.titel || p.titel).slice(0, 500), berechtigte: d?.berechtigte?.length ? d.berechtigte : p.berechtigte, bereiche: d?.bereiche?.length ? d.bereiche : p.bereiche, zuletztGesehen: jetzt, beendetAm: null };
      const detail = d
        ? {
            kurztext: d.kurztext || null, volltext: d.volltext || null, zusatzinfos: d.zusatzinfos || d.rechtsgrundlage || null, foerderart: d.foerderart ?? [],
            foerdergeber: d.foerdergeber || null, kontakt: (d.kontakt ?? undefined) as Prisma.InputJsonValue | undefined, links: d.links ?? [], fristen: d.fristen ?? [], detailAm: jetzt,
          }
        : {};
      if (d) details++;
      const vorher = await db.foerderprogramm.findUnique({ where: { url: p.url }, select: { gebiete: true } });
      const gebiete = [...new Set([...(vorher?.gebiete ?? []), ...p.gebiete])];
      if (vorher) await db.foerderprogramm.update({ where: { url: p.url }, data: { ...basis, gebiete, ...detail } });
      else await db.foerderprogramm.create({ data: { url: p.url, ...basis, gebiete, ...detail } });
    }
    // Beendet: alle Gebiete des Programms vollständig gelesen, aber nicht mehr gesehen
    const beendet = r.vollstaendig.length
      ? (await db.foerderprogramm.updateMany({ where: { beendetAm: null, zuletztGesehen: { lt: lauf.start }, gebiete: { isEmpty: false }, NOT: { gebiete: { hasSome: REGIONEN.filter((x) => !r.vollstaendig.includes(x)) } } }, data: { beendetAm: jetzt } })).count
      : 0;
    const { neu } = await bewertenAlle();
    const fehlerText = r.programme.length === 0 ? "Förderdatenbank nicht erreichbar" : null;
    return await db.foerderLauf.update({ where: { id: lauf.id }, data: { ende: new Date(), programme: r.programme.length, details, neu, beendet, fehler: fehlerText, protokoll: r.log.join("\n").slice(-20000) } });
  } catch (e) {
    await db.foerderLauf.update({ where: { id: lauf.id }, data: { ende: new Date(), fehler: (e as Error).message.slice(0, 2000) } });
    throw e;
  }
}

export async function laufAnstossen(b: AktuellerBenutzer) {
  rollePruefen(b, ["ADMIN"]);
  const laeuft = await db.foerderLauf.findFirst({ where: { ende: null, start: { gte: new Date(Date.now() - 60 * 60_000) } } });
  if (laeuft) throw new FachFehler("Es läuft gerade schon ein Abruf.");
  foerderLaufen().catch((e) => console.error("Fördermittel-Lauf:", e));
}

export async function laeufe(b: AktuellerBenutzer) {
  rollePruefen(b, ["ADMIN"]);
  return db.foerderLauf.findMany({ orderBy: { start: "desc" }, take: 15 });
}

// ------------------------------------------------------------------ Merkliste

export const ANSICHTEN = ["NEU", "GEMERKT", "BEANTRAGT", "AUSSORTIERT", "BEENDET"] as const;
export type Ansicht = (typeof ANSICHTEN)[number];
export const ZIELGRUPPEN = ["alle", "betrieb", "kunde"] as const;

export async function trefferListe(b: AktuellerBenutzer, ansicht: Ansicht, zielgruppe: (typeof ZIELGRUPPEN)[number]) {
  rollePruefen(b);
  return db.foerderTreffer.findMany({
    where: {
      firmaId: b.mandant.id,
      ...(zielgruppe === "alle" ? {} : { zielgruppen: { has: zielgruppe } }),
      ...(ansicht === "BEENDET" ? { status: { not: "AUSSORTIERT" }, programm: { beendetAm: { not: null } } } : { status: ansicht as FoerderStatus, programm: { beendetAm: null } }),
    },
    include: { programm: true, projekt: { select: { id: true, nummer: true, titel: true } }, bearbeitetVon: { select: { name: true } } },
    orderBy: ansicht === "NEU" ? [{ punkte: "desc" }, { createdAt: "desc" }] : [{ updatedAt: "desc" }],
    take: 300,
  });
}

export async function zaehler(firmaId: string) {
  const g = await db.foerderTreffer.groupBy({ by: ["status"], where: { firmaId, programm: { beendetAm: null } }, _count: true });
  return Object.fromEntries(g.map((x) => [x.status, x._count])) as Partial<Record<FoerderStatus, number>>;
}

async function trefferLaden(b: AktuellerBenutzer, id: string) {
  rollePruefen(b);
  const t = await db.foerderTreffer.findUnique({ where: { id }, include: { programm: true } });
  if (!t || t.firmaId !== b.mandant.id) throw new FachFehler("Förderprogramm nicht gefunden.", "NICHT_GEFUNDEN");
  return t;
}

export async function statusSetzen(b: AktuellerBenutzer, id: string, status: FoerderStatus) {
  const t = await trefferLaden(b, id);
  await db.foerderTreffer.update({ where: { id: t.id }, data: { status, bearbeitetVonId: b.id } });
}

export async function notizSetzen(b: AktuellerBenutzer, id: string, notiz: string | null) {
  const t = await trefferLaden(b, id);
  await db.foerderTreffer.update({ where: { id: t.id }, data: { notiz: notiz?.trim().slice(0, 4000) || null, bearbeitetVonId: b.id } });
}

/** Förderung einem Projekt zuordnen (z. B. Dachbegrünung beim Kunden); leer löst die Zuordnung. */
export async function projektSetzen(b: AktuellerBenutzer, id: string, projektId: string | null) {
  const t = await trefferLaden(b, id);
  if (projektId && !(await db.projekt.findFirst({ where: { id: projektId, firmaId: b.mandant.id } }))) throw new FachFehler("Projekt nicht gefunden.");
  await db.foerderTreffer.update({ where: { id: t.id }, data: { projektId, bearbeitetVonId: b.id } });
}

/** Aufgabe „Förderung prüfen“: eine Woche vor der nächsten erkannten Frist, sonst in einer Woche. */
export async function aufgabeAnlegen(b: AktuellerBenutzer, id: string) {
  const t = await trefferLaden(b, id);
  const heute = berlinTag(new Date());
  const frist = t.programm.fristen.find((f) => f > heute);
  const faellig = frist ? (tagPlus(frist, -7) < heute ? heute : tagPlus(frist, -7)) : tagPlus(heute, 7);
  const kunde = t.zielgruppen.includes("kunde") && !t.zielgruppen.includes("betrieb");
  await db.aufgabe.create({
      data: {
        firmaId: b.mandant.id, titel: `${kunde ? "Kundenförderung prüfen" : "Förderantrag prüfen"}: ${t.programm.titel}`.slice(0, 200),
        notiz: [t.programm.url, frist ? `Mögliche Frist laut Text: ${frist.split("-").reverse().join(".")}` : null].filter(Boolean).join("\n"),
        faelligAm: berlinZuUtc(faellig, "12:00"), zustaendigId: b.id, erstelltVonId: b.id, projektId: t.projektId,
      },
    });
  return faellig;
}

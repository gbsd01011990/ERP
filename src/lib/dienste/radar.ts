/**
 * Ausschreibungs-Radar: täglicher Abgleich öffentlicher Ausschreibungen je Firma.
 * Abruf und Bewertung macht radar/radar_erp.py (aus dem Repository ausschreibungs-radar),
 * hier liegen Profile, Bestand, Merkliste und der Weg zum Projekt.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { RadarProfil, RadarStatus } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteNummer } from "../nummern";
import { berlinTag, berlinZuUtc, tagPlus } from "../zeit";
import { FachFehler } from "./fehler";
import { rollePruefen } from "./zugriff";

// ------------------------------------------------------------------ Profile

const GALABAU = {
  regionNuts: ["DE3", "DE4"], regionPlz: ["10", "11", "12", "13", "14", "15", "16"], auftragsarten: ["works", "services", ""],
  cpvPraefixe: ["45112", "45111291", "45233161", "45233162", "45232120", "45342", "77211", "77300", "77310", "77311", "77312", "77313", "77314", "77315", "77320", "77330", "77340", "77341", "03451", "03452", "37535"],
  stichwoerter: ["grünfläche", "grünanlage", "gruenflaeche", "gartenbau", "landschaftsbau", "galabau", "baumpflege", "baumfäll", "baumkontroll", "baumsanierung", "gehölz", "gehoelz", "heckenschnitt", "hecke", "mäharbeit", "mahd", "rasen", "pflanzarbeit", "bepflanzung", "spielplatz", "spielgerät", "außenanlage", "aussenanlage", "freianlage", "wegebau", "pflasterarbeit", "bewässerung", "beregnung", "staude", "parkpflege", "friedhof", "sportplatz", "sportanlage", "dachbegrünung", "biotop", "uferpflege", "renaturierung", "vegetationspflege", "gehwegreinigung", "winterdienst", "landschaftspflege", "baumschnitt", "wildkraut", "unkraut"],
  ausschluss: ["rahmenvertrag ingenieurleistungen", "planungsleistungen", "gutachten", "software", "lieferung von fahrzeugen", "reinigungsdienstleistungen gebäude", "lieferung von", "lieferung einer", "lieferung eines", "beschaffung", "untersuchung einer", "kampfmittel", "möbel", "fahrschul", "gestellung von fahrzeugen", "freianlagenplanung"],
};
const BAUMDIENST = {
  ...GALABAU,
  cpvPraefixe: ["77211", "77341", "77340", "77310", "45111291"],
  stichwoerter: ["baum", "bäume", "gehölz", "gehoelz", "fällung", "fäll", "kronenpflege", "kronenschnitt", "totholz", "verkehrssicherung", "baumkontroll", "baumschnitt", "baumpflege", "baumsanierung", "stubben", "wurzel", "seilklettertechnik", "hubarbeitsbühne", "alleen", "allee", "sturmschäden", "eichenprozessionsspinner", "astbruch"],
};
/** Ausgangsprofile; RD entspricht der bisherigen config.json des eigenständigen Radars. */
export const STANDARD_PROFIL: Record<string, typeof GALABAU> = { RD: GALABAU, GBSD: GALABAU, KUD: BAUMDIENST };

export async function profilFuer(firmaId: string) {
  const p = await db.radarProfil.findUnique({ where: { firmaId } });
  if (p) return p;
  const f = await db.firma.findUniqueOrThrow({ where: { id: firmaId } });
  return db.radarProfil.create({ data: { firmaId, ...(STANDARD_PROFIL[f.kuerzel] ?? GALABAU) } });
}

const alsConfig = (p: RadarProfil) => ({
  region_nuts: p.regionNuts, region_plz: p.regionPlz, erlaubte_auftragsarten: p.auftragsarten, cpv_praefixe: p.cpvPraefixe,
  keywords: p.stichwoerter.map((k) => k.toLowerCase()), ausschluss_titel: p.ausschluss.map((k) => k.toLowerCase()),
  mindest_score: p.mindestScore, score_cpv: p.scoreCpv, score_keyword_titel: p.scoreTitel, score_keyword_beschreibung: p.scoreText,
});

const liste = z.string().transform((s) => [...new Set(s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))]);
export const ProfilEingabe = z.object({
  aktiv: z.boolean(),
  regionNuts: liste, regionPlz: liste, cpvPraefixe: liste, stichwoerter: liste, ausschluss: liste,
  auftragsarten: z.array(z.enum(["works", "services", "supplies", ""])),
  mindestScore: z.number().int().min(1).max(20), scoreCpv: z.number().int().min(0).max(10), scoreTitel: z.number().int().min(0).max(10), scoreText: z.number().int().min(0).max(10),
});

export async function profilSpeichern(b: AktuellerBenutzer, eingabe: z.input<typeof ProfilEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  const e = ProfilEingabe.parse(eingabe);
  if (!e.regionNuts.length && !e.regionPlz.length) throw new FachFehler("Bitte mindestens eine Region (NUTS oder PLZ) angeben.");
  if (!e.cpvPraefixe.length && !e.stichwoerter.length) throw new FachFehler("Ohne CPV-Codes und Stichwörter findet das Radar nichts.");
  await profilFuer(b.mandant.id);
  await db.radarProfil.update({ where: { firmaId: b.mandant.id }, data: e });
}

// ------------------------------------------------------------------ Lauf

type Treffer = {
  kennung: string; quelle: string; titel: string; beschreibung: string; auftraggeber: string; ort: string; plz: string; auftragsart: string;
  wert: string; cpv: string[]; veroeffentlicht: string; frist_datum: string; frist_zeit: string; portal: string; verfahren: string; bekanntmachung: string;
  profile: { id: string; punkte: number; gruende: string[] }[];
};

function python(eingabe: object): Promise<{ tage_geladen: number; berlin: number; treffer: Treffer[]; log: string[] }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.PYTHON ?? "python3", ["-I", path.join(process.cwd(), "radar", "radar_erp.py")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => {
      try { const j = JSON.parse(out); if (code === 2) j.log.push("FEHLER: Keine Quelle erreichbar."); resolve(j); } catch { reject(new Error(`Radar ohne Antwort (Exit ${code}): ${err.slice(-800)}`)); }
    });
    p.stdin.end(JSON.stringify(eingabe));
  });
}

const fristAus = (datum: string, zeit: string) => (/^\d{4}-\d{2}-\d{2}$/.test(datum) ? berlinZuUtc(datum, /^\d{2}:\d{2}$/.test(zeit) ? zeit : "23:59") : null);

/**
 * Ein Lauf: Tage seit dem letzten erfolgreichen Lauf (höchstens 14, sonst gestern) für alle
 * aktiven Profile. Neue Bekanntmachungen werden angelegt, bekannte ergänzt (Frist, Portal).
 */
export async function radarLaufen(o: { tage?: number } = {}) {
  const profile = await Promise.all((await db.firma.findMany({ select: { id: true } })).map((f) => profilFuer(f.id)));
  const aktiv = profile.filter((p) => p.aktiv);
  const heute = berlinTag(new Date());
  const letzter = await db.radarLauf.findFirst({ where: { fehler: null, ende: { not: null } }, orderBy: { start: "desc" } });
  const spanne = o.tage ?? (letzter ? Math.min(14, Math.max(1, Math.round((Date.parse(heute) - Date.parse(berlinTag(letzter.start))) / 864e5))) : 1);
  const tage = Array.from({ length: spanne }, (_, i) => tagPlus(heute, -(spanne - i)));
  const lauf = await db.radarLauf.create({ data: { tage } });
  try {
    if (!aktiv.length) throw new Error("Kein aktives Radar-Profil.");
    const bekannt = (await db.ausschreibung.findMany({ select: { kennung: true } })).map((a) => a.kennung);
    const r = await python({ tage, profile: aktiv.map((p) => ({ id: p.firmaId, config: alsConfig(p) })), bekannt });
    let neu = 0;
    for (const t of r.treffer) {
      const frist = fristAus(t.frist_datum, t.frist_zeit);
      const wert = Number(t.wert);
      const vorher = await db.ausschreibung.findUnique({ where: { kennung: t.kennung } });
      const a = vorher
        ? await db.ausschreibung.update({ where: { id: vorher.id }, data: { ...(frist && !vorher.frist ? { frist, fristOhneZeit: !t.frist_zeit } : {}), ...(t.portal && !vorher.portalUrl ? { portalUrl: t.portal } : {}) } })
        : await db.ausschreibung.create({
            data: {
              kennung: t.kennung, quelle: t.quelle, titel: t.titel.slice(0, 500), beschreibung: t.beschreibung || null, auftraggeber: t.auftraggeber || null,
              ort: t.ort || null, plz: t.plz || null, auftragsart: t.auftragsart || null, verfahren: t.verfahren || null,
              wert: Number.isFinite(wert) && wert > 0 ? wert : null, cpv: t.cpv, veroeffentlicht: /^\d{4}-\d{2}-\d{2}$/.test(t.veroeffentlicht) ? berlinZuUtc(t.veroeffentlicht, "12:00") : null,
              frist, fristOhneZeit: !!frist && !t.frist_zeit, portalUrl: t.portal || null, bekanntmachungUrl: t.bekanntmachung || null,
            },
          });
      for (const p of t.profile) {
        const schluessel = { ausschreibungId_firmaId: { ausschreibungId: a.id, firmaId: p.id } };
        if (await db.ausschreibungTreffer.findUnique({ where: schluessel })) {
          await db.ausschreibungTreffer.update({ where: schluessel, data: { punkte: p.punkte, gruende: p.gruende } });
        } else {
          await db.ausschreibungTreffer.create({ data: { ausschreibungId: a.id, firmaId: p.id, punkte: p.punkte, gruende: p.gruende } });
          neu++;
        }
      }
    }
    const fehlerText = r.tage_geladen === 0 && r.berlin === 0 && tage.length ? "Keine Quelle erreichbar" : null;
    return await db.radarLauf.update({ where: { id: lauf.id }, data: { ende: new Date(), neu, treffer: r.treffer.length, fehler: fehlerText, protokoll: r.log.join("\n").slice(-20000) } });
  } catch (e) {
    await db.radarLauf.update({ where: { id: lauf.id }, data: { ende: new Date(), fehler: (e as Error).message.slice(0, 2000) } });
    throw e;
  }
}

/** Admin: Lauf von Hand anstoßen (läuft im Hintergrund weiter). */
export async function laufAnstossen(b: AktuellerBenutzer, tage: number) {
  rollePruefen(b, ["ADMIN"]);
  if (!(tage >= 1 && tage <= 14)) throw new FachFehler("1 bis 14 Tage.");
  const laeuft = await db.radarLauf.findFirst({ where: { ende: null, start: { gte: new Date(Date.now() - 30 * 60_000) } } });
  if (laeuft) throw new FachFehler("Es läuft gerade schon ein Abruf.");
  radarLaufen({ tage }).catch((e) => console.error("Radar-Lauf:", e));
}

// ------------------------------------------------------------------ Merkliste und Projekt

export const ANSICHTEN = ["NEU", "TEILNAHME", "AUSSORTIERT", "ABGELAUFEN"] as const;

export async function trefferListe(b: AktuellerBenutzer, ansicht: (typeof ANSICHTEN)[number]) {
  rollePruefen(b);
  const jetzt = new Date();
  const offen = { OR: [{ frist: null }, { frist: { gte: jetzt } }] };
  return db.ausschreibungTreffer.findMany({
    where: {
      firmaId: b.mandant.id,
      ...(ansicht === "ABGELAUFEN" ? { ausschreibung: { frist: { lt: jetzt } } } : { status: ansicht as RadarStatus, ausschreibung: ansicht === "TEILNAHME" ? {} : offen }),
    },
    include: { ausschreibung: true, projekt: { select: { id: true, nummer: true } }, bearbeitetVon: { select: { name: true } } },
    orderBy: ansicht === "NEU" ? [{ ausschreibung: { frist: { sort: "asc", nulls: "last" } } }, { punkte: "desc" }] : [{ updatedAt: "desc" }],
    take: 300,
  });
}

export async function zaehler(firmaId: string) {
  const jetzt = new Date();
  const g = await db.ausschreibungTreffer.groupBy({ by: ["status"], where: { firmaId, ausschreibung: { OR: [{ frist: null }, { frist: { gte: jetzt } }] } }, _count: true });
  return Object.fromEntries(g.map((x) => [x.status, x._count])) as Partial<Record<RadarStatus, number>>;
}

async function trefferLaden(b: AktuellerBenutzer, id: string) {
  rollePruefen(b);
  const t = await db.ausschreibungTreffer.findUnique({ where: { id }, include: { ausschreibung: true } });
  if (!t || t.firmaId !== b.mandant.id) throw new FachFehler("Ausschreibung nicht gefunden.", "NICHT_GEFUNDEN");
  return t;
}

export async function statusSetzen(b: AktuellerBenutzer, id: string, status: RadarStatus, notiz?: string | null) {
  const t = await trefferLaden(b, id);
  if (t.projektId && status !== "TEILNAHME") throw new FachFehler("Aus dieser Ausschreibung ist schon ein Projekt entstanden.");
  await db.ausschreibungTreffer.update({ where: { id: t.id }, data: { status, bearbeitetVonId: b.id, ...(notiz !== undefined ? { notiz: notiz?.trim() || null } : {}) } });
}

/**
 * Teilnahme als Projekt: Auftraggeber als öffentlicher Kontakt (vorhandener wird wiederverwendet),
 * Projekt im ersten Pipeline-Status mit allen Links, Aufgabe „Vergabeunterlagen sichten“ eine Woche vor der Frist.
 */
export async function alsProjekt(b: AktuellerBenutzer, id: string) {
  const t = await trefferLaden(b, id);
  if (t.projektId) throw new FachFehler("Dazu gibt es schon ein Projekt.");
  const a = t.ausschreibung;
  const name = (a.auftraggeber || "Öffentlicher Auftraggeber").slice(0, 200);
  const status = await db.pipelineStatus.findFirstOrThrow({ where: { firmaId: b.mandant.id }, orderBy: { reihenfolge: "asc" } });
  const faellig = a.frist ? tagPlus(berlinTag(a.frist), -7) : tagPlus(berlinTag(new Date()), 1);
  const heute = berlinTag(new Date());
  return db.$transaction(async (tx) => {
    const kontakt = (await tx.kontakt.findFirst({ where: { geloescht: false, firmenname: { equals: name, mode: "insensitive" } } }))
      ?? (await tx.kontakt.create({ data: { typ: "KUNDE", kategorie: "OEFFENTLICH", firmenname: name, adressen: a.ort ? { create: { art: "HAUPT", plz: a.plz?.split(",")[0]?.trim() || null, ort: a.ort.split(",")[0].trim() } } : undefined } }));
    const nummer = await naechsteNummer(tx, b.mandant.id, "PROJEKT");
    const beschreibung = [
      a.beschreibung?.slice(0, 2000),
      a.frist ? `Angebotsfrist: ${a.frist.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", ...(a.fristOhneZeit ? {} : { timeStyle: "short" }) })}` : null,
      a.portalUrl ? `Vergabeunterlagen: ${a.portalUrl}` : null,
      a.bekanntmachungUrl ? `Bekanntmachung: ${a.bekanntmachungUrl}` : null,
      `Quelle: ${a.quelle} (Kennung ${a.kennung})`,
    ].filter(Boolean).join("\n\n");
    const p = await tx.projekt.create({
      data: {
        firmaId: b.mandant.id, nummer, titel: a.titel.slice(0, 200), kontaktId: kontakt.id, statusId: status.id, quelle: "Ausschreibung",
        beschreibung, volumen: a.wert, baustellePlz: a.plz?.split(",")[0]?.trim() || null, baustelleOrt: a.ort?.split(",")[0]?.trim() || null, verantwortlichId: b.id,
        logbuch: { create: { art: "SYSTEM", text: `Aus dem Ausschreibungs-Radar übernommen (${a.quelle})`, benutzerId: b.id } },
      },
    });
    await tx.aufgabe.create({
      data: {
        firmaId: b.mandant.id, titel: "Vergabeunterlagen sichten, Teilnahme entscheiden", notiz: a.portalUrl ?? a.bekanntmachungUrl ?? null,
        faelligAm: berlinZuUtc(faellig < heute ? heute : faellig, "12:00"), zustaendigId: b.id, erstelltVonId: b.id, kontaktId: kontakt.id, projektId: p.id,
      },
    });
    await tx.ausschreibungTreffer.update({ where: { id: t.id }, data: { status: "TEILNAHME", projektId: p.id, bearbeitetVonId: b.id } });
    return p;
  });
}

export async function notizSetzen(b: AktuellerBenutzer, id: string, notiz: string | null) {
  const t = await trefferLaden(b, id);
  await db.ausschreibungTreffer.update({ where: { id: t.id }, data: { notiz: notiz?.trim().slice(0, 4000) || null, bearbeitetVonId: b.id } });
}

/** Letzte Läufe für die Einstellungsseite. */
export async function laeufe(b: AktuellerBenutzer) {
  rollePruefen(b, ["ADMIN"]);
  return db.radarLauf.findMany({ orderBy: { start: "desc" }, take: 15 });
}

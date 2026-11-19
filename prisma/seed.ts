// Legt die drei Firmen, Pipeline, Projekttypen, Nummernkreise und den ersten Admin an.
// Mehrfach ausführbar: vorhandene Einträge bleiben unverändert.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import path from "node:path";

const db = new PrismaClient();

const FIRMEN = [
  { kuerzel: "GBSD", name: "GBSD GmbH", zusatz: "Garten- & Landschaftsbau · Baumpflege", ort: "Werder (Havel)", farbe: "#2f5d3a", projektPraefix: "GB" },
  { kuerzel: "RD", name: "Riedrich und Dremel GmbH", zusatz: "Gärtner von Eden · Garten- & Landschaftsbau", ort: "Werder (Havel)", farbe: "#4a6b2f", projektPraefix: "RD" },
  { kuerzel: "KUD", name: "Kusche und Dremel GmbH", zusatz: "Baumdienst", ort: "Falkensee", farbe: "#6b4a2f", projektPraefix: "KD" },
];

const PIPELINE = [
  { name: "Neu - Erstkontakt", farbe: "#0ea5e9" },
  { name: "Vor-Ort-Termin", farbe: "#6366f1" },
  { name: "Angebot in Arbeit", farbe: "#a855f7" },
  { name: "Angebot versendet", farbe: "#f59e0b" },
  { name: "Auftragsbestätigung", farbe: "#10b981" },
  { name: "In Ausführung", farbe: "#14b8a6" },
  { name: "Kundenrechnung", farbe: "#84cc16" },
  { name: "Abgeschlossen", farbe: "#64748b", abgeschlossen: true },
  { name: "Verloren", farbe: "#ef4444", abgeschlossen: true, verloren: true },
];

const TYPEN = ["Projekt", "Kleinauftrag", "Pflege", "Baumpflege", "Ausschreibung"];

async function main() {
  for (const f of FIRMEN) {
    const firma = await db.firma.upsert({ where: { kuerzel: f.kuerzel }, update: {}, create: f });
    for (const [i, s] of PIPELINE.entries()) {
      await db.pipelineStatus.upsert({
        where: { firmaId_name: { firmaId: firma.id, name: s.name } },
        update: {},
        create: { firmaId: firma.id, reihenfolge: (i + 1) * 10, ...s },
      });
    }
    for (const name of TYPEN) {
      await db.projektTyp.upsert({ where: { firmaId_name: { firmaId: firma.id, name } }, update: {}, create: { firmaId: firma.id, name } });
    }
    for (const art of ["PROJEKT", "ANGEBOT", "AUFTRAG", "AUFMASS", "LIEFERSCHEIN", "BESTELLUNG"]) {
      const praefix = art === "PROJEKT" ? `${f.projektPraefix}-` : `${f.projektPraefix}-${art.slice(0, 2)}-`;
      await db.nummernkreis.upsert({
        where: { firmaId_art: { firmaId: firma.id, art } },
        update: {},
        create: { firmaId: firma.id, art, praefix, naechste: 1, stellen: art === "PROJEKT" ? 3 : 4 },
      });
    }
    // Rechnungen: GBSD führt seinen bisherigen Kreis fort (2026-114). Anpassbar unter Einstellungen → Nummernkreise.
    const re = f.kuerzel === "GBSD"
      ? { praefix: "2026-", naechste: 114, stellen: 3, jahresweise: false }
      : { praefix: `${f.projektPraefix}-RE-{JJJJ}-`, naechste: 1, stellen: 3, jahresweise: true };
    await db.nummernkreis.upsert({
      where: { firmaId_art: { firmaId: firma.id, art: "RECHNUNG" } },
      update: {},
      create: { firmaId: firma.id, art: "RECHNUNG", ...re },
    });
  }

  // Ausschreibungs-Radar: offene Ausschreibungen aus dem bisherigen, eigenständigen Radar (Riedrich und Dremel)
  // einmalig übernehmen, solange RD noch keine Treffer im ERP hat.
  const rd = await db.firma.findUnique({ where: { kuerzel: "RD" } });
  if (rd && (await db.ausschreibungTreffer.count({ where: { firmaId: rd.id } })) === 0) {
    const bestand = JSON.parse(readFileSync(path.join(process.cwd(), "radar", "startbestand-rd.json"), "utf8")) as Record<string, {
      titel: string; auftraggeber?: string; ort?: string; plz?: string; auftragsart?: string; wert?: string; punkte: number; gruende: string[];
      frist_datum?: string; frist_zeit?: string; portal?: string; bekanntmachung?: string; gemeldet_am?: string; quelle?: string;
    }>;
    const berlin = (tag: string, zeit: string) => { const d = new Date(`${tag}T${zeit}:00Z`); const off = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hour: "numeric", hourCycle: "h23" }).format(d)) - d.getUTCHours(); return new Date(d.getTime() - ((off + 24) % 24) * 3600e3); };
    for (const [kennung, e] of Object.entries(bestand)) {
      const wert = Number((e.wert ?? "").replace(/[^\d]/g, ""));
      const a = await db.ausschreibung.upsert({
        where: { kennung }, update: {},
        create: {
          kennung, quelle: e.quelle ?? "Datenservice des Bundes", titel: e.titel.slice(0, 500), auftraggeber: e.auftraggeber || null, ort: e.ort || null, plz: e.plz || null,
          auftragsart: e.auftragsart || null, wert: wert > 0 ? wert : null, cpv: [],
          frist: e.frist_datum ? berlin(e.frist_datum, e.frist_zeit || "23:59") : null, fristOhneZeit: !!e.frist_datum && !e.frist_zeit,
          portalUrl: e.portal || null, bekanntmachungUrl: e.bekanntmachung || null, erstGesehen: e.gemeldet_am ? new Date(`${e.gemeldet_am}T06:00:00Z`) : new Date(),
        },
      });
      await db.ausschreibungTreffer.upsert({ where: { ausschreibungId_firmaId: { ausschreibungId: a.id, firmaId: rd.id } }, update: {}, create: { ausschreibungId: a.id, firmaId: rd.id, punkte: e.punkte, gruende: e.gruende } });
    }
    console.log(`Radar: ${Object.keys(bestand).length} offene Ausschreibungen aus dem bisherigen Radar übernommen`);
  }

  const email = process.env.ADMIN_EMAIL ?? "admin@example.de";
  const pw = process.env.ADMIN_PASSWORT;
  if (!(await db.benutzer.findUnique({ where: { email } }))) {
    if (!pw) throw new Error("ADMIN_PASSWORT fehlt – bitte in .env setzen.");
    const firmen = await db.firma.findMany();
    await db.benutzer.create({
      data: {
        email,
        name: "Administrator",
        rolle: "ADMIN",
        passwortHash: await bcrypt.hash(pw, 12),
        zugriffe: { create: firmen.map((f) => ({ firmaId: f.id })) },
      },
    });
    console.log(`Admin ${email} angelegt.`);
  }
  console.log("Seed fertig.");
}

main().finally(() => db.$disconnect());

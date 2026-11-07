// Legt die drei Firmen, Pipeline, Projekttypen, Nummernkreise und den ersten Admin an.
// Mehrfach ausführbar: vorhandene Einträge bleiben unverändert.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

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
    for (const art of ["PROJEKT", "ANGEBOT", "AUFTRAG", "AUFMASS", "LIEFERSCHEIN"]) {
      const praefix = art === "PROJEKT" ? `${f.projektPraefix}-` : `${f.projektPraefix}-${art.slice(0, 2)}-`;
      await db.nummernkreis.upsert({
        where: { firmaId_art: { firmaId: firma.id, art } },
        update: {},
        create: { firmaId: firma.id, art, praefix, naechste: 1, stellen: art === "PROJEKT" ? 3 : 4 },
      });
    }
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

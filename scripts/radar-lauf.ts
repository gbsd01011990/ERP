/**
 * Ausschreibungs- und Fördermittel-Radar im Hintergrund: einmal täglich nach RADAR_UHRZEIT
 * (Berliner Zeit, Standard 06:30), danach die Förderdatenbank.
 * Läuft auf dem Server als eigener Dienst (docker-compose: radar).
 *
 *   npx tsx scripts/radar-lauf.ts            # Dauerbetrieb
 *   npx tsx scripts/radar-lauf.ts --einmal   # ein Lauf (seit dem letzten, höchstens 14 Tage)
 *   npx tsx scripts/radar-lauf.ts --einmal --tage 3
 *   npx tsx scripts/radar-lauf.ts --foerder  # nur Fördermittel, einmal
 */
import { db } from "../src/lib/db";
import { radarLaufen } from "../src/lib/dienste/radar";
import { foerderLaufen } from "../src/lib/dienste/foerdermittel";
import { berlinTag, berlinUhrzeit } from "../src/lib/zeit";

const UHRZEIT = process.env.RADAR_UHRZEIT ?? "06:30";
const stempel = () => new Date().toISOString().slice(0, 19);

async function einmal(tage?: number) {
  const l = await radarLaufen({ tage });
  console.log(`${stempel()} Radar: ${l.treffer} relevant, ${l.neu} neu für die Firmen${l.fehler ? `, FEHLER: ${l.fehler}` : ""}`);
}

async function foerder() {
  const l = await foerderLaufen();
  console.log(`${stempel()} Fördermittel: ${l.programme} Programme, ${l.details} Einzelseiten, ${l.neu} neu, ${l.beendet} beendet${l.fehler ? `, FEHLER: ${l.fehler}` : ""}`);
}

async function main() {
  if (process.argv.includes("--foerder")) return foerder();
  const i = process.argv.indexOf("--tage");
  if (process.argv.includes("--einmal")) return einmal(i > 0 ? Number(process.argv[i + 1]) : undefined);
  console.log(`${stempel()} Radar-Dienst gestartet, täglich ab ${UHRZEIT} Uhr (Ausschreibungen, dann Fördermittel)`);
  for (;;) {
    const heute = berlinTag(new Date());
    const schonGelaufen = await db.radarLauf.findFirst({ where: { start: { gte: new Date(Date.parse(heute) - 2 * 3600e3) }, fehler: null } });
    if (!schonGelaufen && berlinUhrzeit(new Date()) >= UHRZEIT) await einmal().catch((e) => console.error(stempel(), e));
    // Höchstens drei Versuche am Tag, damit die Bot-Abwehr der Förderdatenbank nicht anspringt
    const seitHeute = { start: { gte: new Date(Date.parse(heute) - 2 * 3600e3) } };
    const foerderHeute = (await db.foerderLauf.count({ where: { ...seitHeute, fehler: null } })) > 0 || (await db.foerderLauf.count({ where: seitHeute })) >= 3;
    if (!foerderHeute && berlinUhrzeit(new Date()) >= UHRZEIT) await foerder().catch((e) => console.error(stempel(), e));
    await new Promise((r) => setTimeout(r, 10 * 60_000));
  }
}

main().finally(() => db.$disconnect());

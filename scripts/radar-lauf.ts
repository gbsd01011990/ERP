/**
 * Ausschreibungs-Radar im Hintergrund: einmal täglich nach RADAR_UHRZEIT (Berliner Zeit, Standard 06:30).
 * Läuft auf dem Server als eigener Dienst (docker-compose: radar).
 *
 *   npx tsx scripts/radar-lauf.ts            # Dauerbetrieb
 *   npx tsx scripts/radar-lauf.ts --einmal   # ein Lauf (seit dem letzten, höchstens 14 Tage)
 *   npx tsx scripts/radar-lauf.ts --einmal --tage 3
 */
import { db } from "../src/lib/db";
import { radarLaufen } from "../src/lib/dienste/radar";
import { berlinTag, berlinUhrzeit } from "../src/lib/zeit";

const UHRZEIT = process.env.RADAR_UHRZEIT ?? "06:30";
const stempel = () => new Date().toISOString().slice(0, 19);

async function einmal(tage?: number) {
  const l = await radarLaufen({ tage });
  console.log(`${stempel()} Radar: ${l.treffer} relevant, ${l.neu} neu für die Firmen${l.fehler ? `, FEHLER: ${l.fehler}` : ""}`);
}

async function main() {
  const i = process.argv.indexOf("--tage");
  if (process.argv.includes("--einmal")) return einmal(i > 0 ? Number(process.argv[i + 1]) : undefined);
  console.log(`${stempel()} Radar-Dienst gestartet, täglich ab ${UHRZEIT} Uhr`);
  for (;;) {
    const heute = berlinTag(new Date());
    const schonGelaufen = await db.radarLauf.findFirst({ where: { start: { gte: new Date(Date.parse(heute) - 2 * 3600e3) }, fehler: null } });
    if (!schonGelaufen && berlinUhrzeit(new Date()) >= UHRZEIT) await einmal().catch((e) => console.error(stempel(), e));
    await new Promise((r) => setTimeout(r, 10 * 60_000));
  }
}

main().finally(() => db.$disconnect());

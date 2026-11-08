/**
 * Mail-Abruf im Hintergrund: ruft alle aktiven Postfächer regelmäßig ab.
 * Läuft auf dem Server als eigener Dienst (docker-compose: mailabruf).
 *
 *   npx tsx scripts/mail-abruf.ts            # Dauerbetrieb, Intervall MAIL_INTERVALL_SEKUNDEN (Standard 120)
 *   npx tsx scripts/mail-abruf.ts --einmal   # ein Durchlauf
 */
import { db } from "../src/lib/db";
import { postfachAbrufen } from "../src/lib/dienste/mail";

const INTERVALL = Number(process.env.MAIL_INTERVALL_SEKUNDEN ?? 120) * 1000;
const stempel = () => new Date().toISOString().slice(0, 19);

async function durchlauf() {
  const postfaecher = await db.postfach.findMany({ where: { aktiv: true }, select: { id: true, adresse: true } });
  for (const p of postfaecher) {
    try {
      const r = await postfachAbrufen(p.id);
      if (r.neu) console.log(`${stempel()} ${p.adresse}: ${r.neu} neu`);
    } catch (e) {
      console.error(`${stempel()} ${p.adresse}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function main() {
  if (process.argv.includes("--einmal")) return durchlauf();
  console.log(`${stempel()} Mail-Abruf gestartet, alle ${INTERVALL / 1000} s`);
  for (;;) {
    await durchlauf().catch((e) => console.error(stempel(), e));
    await new Promise((r) => setTimeout(r, INTERVALL));
  }
}

main().finally(() => db.$disconnect());

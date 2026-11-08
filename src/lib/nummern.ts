import type { Prisma } from "@prisma/client";
import { berlinTag } from "./zeit";

type Kreis = { praefix: string; stellen: number };

/** Platzhalter im Präfix: {JJJJ} = Jahr vierstellig, {JJ} = zweistellig. */
export function nummerFormatieren(k: Kreis, nr: number, jahr: number) {
  const p = k.praefix.replaceAll("{JJJJ}", String(jahr)).replaceAll("{JJ}", String(jahr % 100).padStart(2, "0"));
  return `${p}${String(nr).padStart(k.stellen, "0")}`;
}

export const jahrVon = (d: Date) => Number(berlinTag(d).slice(0, 4));

/** Vorschau ohne Vergabe: welche Nummer käme als Nächstes? */
export function naechsteVorschau(k: Kreis & { naechste: number; jahresweise: boolean; jahr: number | null }, jetzt = new Date()) {
  const jahr = jahrVon(jetzt);
  const nr = k.jahresweise && k.jahr != null && k.jahr !== jahr ? 1 : k.naechste;
  return nummerFormatieren(k, nr, jahr);
}

/**
 * Zieht die nächste Nummer atomar aus dem Nummernkreis (innerhalb einer Transaktion aufrufen).
 * Das erste Update sperrt die Zeile, parallele Vergaben warten also aufeinander.
 */
export async function naechsteNummer(tx: Prisma.TransactionClient, firmaId: string, art: string, stichtag = new Date()) {
  const jahr = jahrVon(stichtag);
  let k = await tx.nummernkreis.update({
    where: { firmaId_art: { firmaId, art } },
    data: { naechste: { increment: 1 } },
  });
  if (k.jahresweise && k.jahr != null && k.jahr !== jahr) {
    k = await tx.nummernkreis.update({ where: { id: k.id }, data: { naechste: 2, jahr } });
  } else if (k.jahr !== jahr) {
    k = await tx.nummernkreis.update({ where: { id: k.id }, data: { jahr } });
  }
  return nummerFormatieren(k, k.naechste - 1, jahr);
}

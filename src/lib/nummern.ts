import type { Prisma } from "@prisma/client";

/** Zieht die nächste Nummer atomar aus dem Nummernkreis (innerhalb einer Transaktion aufrufen). */
export async function naechsteNummer(tx: Prisma.TransactionClient, firmaId: string, art: string) {
  const k = await tx.nummernkreis.update({
    where: { firmaId_art: { firmaId, art } },
    data: { naechste: { increment: 1 } },
  });
  const nr = k.naechste - 1;
  return `${k.praefix}${String(nr).padStart(k.stellen, "0")}`;
}

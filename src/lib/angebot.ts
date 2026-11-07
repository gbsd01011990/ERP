import "server-only";
import { db } from "./db";
import { firmenIds, type AktuellerBenutzer } from "./auth";
import { summen } from "./kalkulation";

export const angebotInclude = {
  firma: true,
  projekt: { include: { kontakt: { include: { adressen: true } } } },
  positionen: { orderBy: { reihenfolge: "asc" as const }, include: { aufmass: { orderBy: { reihenfolge: "asc" as const } } } },
  erstelltVon: { select: { name: true } },
};

export async function ladeAngebot(id: string, b: AktuellerBenutzer) {
  const a = await db.angebot.findUnique({ where: { id }, include: angebotInclude });
  if (!a || !firmenIds(b).includes(a.firmaId)) return null;
  return a;
}

export type GeladenesAngebot = NonNullable<Awaited<ReturnType<typeof ladeAngebot>>>;

export const angebotSummen = (a: GeladenesAngebot) =>
  summen(a.positionen, { stundensatz: a.stundensatz, materialAufschlag: a.materialAufschlag, fremdAufschlag: a.fremdAufschlag, mwstSatz: a.mwstSatz });

/** Nettosumme neu berechnen und speichern (für Listen und Pipeline). */
export async function nettoAktualisieren(angebotId: string) {
  const a = await db.angebot.findUniqueOrThrow({ where: { id: angebotId }, include: { positionen: true } });
  const s = summen(a.positionen, { stundensatz: a.stundensatz, materialAufschlag: a.materialAufschlag, fremdAufschlag: a.fremdAufschlag, mwstSatz: a.mwstSatz });
  await db.angebot.update({ where: { id: angebotId }, data: { netto: s.netto } });
}

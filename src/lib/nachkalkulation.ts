import "server-only";
import { db } from "./db";
import { n, runden, summen } from "./kalkulation";

/**
 * Soll aus dem maßgeblichen Beleg (letzte gültige Auftragsbestätigung, sonst angenommenes,
 * sonst jüngstes offenes Angebot) gegen Ist aus Lagerentnahmen und Geräteeinsätzen.
 * Lohnstunden-Ist folgt mit der Zeiterfassung.
 */
export async function nachkalkulation(projektId: string) {
  const [belege, entnahmen, einsaetze] = await Promise.all([
    db.angebot.findMany({
      where: { projektId, status: { notIn: ["ERSETZT", "ABGELEHNT"] } },
      include: { positionen: true },
      orderBy: { createdAt: "desc" },
    }),
    db.lagerBuchung.findMany({ where: { projektId, art: "PROJEKT" }, include: { artikel: true }, orderBy: { createdAt: "desc" } }),
    db.geraetEinsatz.findMany({ where: { projektId }, include: { geraet: true }, orderBy: { datum: "desc" } }),
  ]);
  const basis =
    belege.find((b) => b.art === "AUFTRAGSBESTAETIGUNG") ??
    belege.find((b) => b.status === "ANGENOMMEN") ??
    belege[0] ??
    null;
  const soll = basis
    ? summen(basis.positionen, { stundensatz: basis.stundensatz, materialAufschlag: basis.materialAufschlag, fremdAufschlag: basis.fremdAufschlag, mwstSatz: basis.mwstSatz })
    : null;
  const istMaterial = runden(entnahmen.reduce((s, e) => s + n(e.wert), 0));
  const istGeraete = runden(einsaetze.reduce((s, e) => s + n(e.stunden) * n(e.kostensatz), 0));
  const istGeraeteStunden = einsaetze.reduce((s, e) => s + n(e.stunden), 0);
  return { basis, soll, istMaterial, istGeraete, istGeraeteStunden, entnahmen, einsaetze };
}

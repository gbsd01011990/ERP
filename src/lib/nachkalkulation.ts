import "server-only";
import { db } from "./db";
import { n, runden, summen } from "./kalkulation";

/**
 * Soll aus dem maßgeblichen Beleg (letzte gültige Auftragsbestätigung, sonst angenommenes,
 * sonst jüngstes offenes Angebot) gegen Ist aus Lagerentnahmen und Geräteeinsätzen.
 * Lohnstunden-Ist aus der Zeiterfassung (ohne Pausen).
 */
export async function nachkalkulation(projektId: string) {
  const [belege, entnahmen, einsaetze, zeiten] = await Promise.all([
    db.angebot.findMany({
      where: { projektId, status: { notIn: ["ERSETZT", "ABGELEHNT"] } },
      include: { positionen: true },
      orderBy: { createdAt: "desc" },
    }),
    db.lagerBuchung.findMany({ where: { projektId, art: "PROJEKT" }, include: { artikel: true }, orderBy: { createdAt: "desc" } }),
    db.geraetEinsatz.findMany({ where: { projektId }, include: { geraet: true }, orderBy: { datum: "desc" } }),
    db.zeiteintrag.findMany({ where: { projektId, kategorie: { not: "PAUSE" }, ende: { not: null } }, include: { benutzer: { select: { name: true } } } }),
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
  // Lohnstunden aus der Zeiterfassung, je Mitarbeiter; bewertet mit dem Stundensatz des Soll-Belegs
  const proMitarbeiter = new Map<string, number>();
  for (const z of zeiten) {
    const min = (z.ende!.getTime() - z.beginn.getTime()) / 60000;
    proMitarbeiter.set(z.benutzer.name, (proMitarbeiter.get(z.benutzer.name) ?? 0) + min);
  }
  const istLohnMinuten = [...proMitarbeiter.values()].reduce((a, b) => a + b, 0);
  const istLohnStunden = Math.round((istLohnMinuten / 60) * 10) / 10;
  const istLohn = basis ? runden((istLohnMinuten / 60) * n(basis.stundensatz)) : null;
  const lohnJeMitarbeiter = [...proMitarbeiter.entries()].map(([name, min]) => ({ name, stunden: Math.round((min / 60) * 10) / 10 })).sort((a, b) => b.stunden - a.stunden);
  return { basis, soll, istMaterial, istGeraete, istGeraeteStunden, istLohnStunden, istLohn, lohnJeMitarbeiter, entnahmen, einsaetze };
}

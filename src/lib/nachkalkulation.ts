import "server-only";
import { db } from "./db";
import { n, runden, summen } from "./kalkulation";

/**
 * Soll aus dem maßgeblichen Beleg (letzte gültige Auftragsbestätigung, sonst angenommenes,
 * sonst jüngstes offenes Angebot) gegen Ist aus Lagerentnahmen und Geräteeinsätzen.
 * Lohnstunden-Ist aus der Zeiterfassung (ohne Pausen).
 */
export async function nachkalkulation(projektId: string) {
  const [belege, entnahmen, einsaetze, zeiten, eingaenge] = await Promise.all([
    db.angebot.findMany({
      where: { projektId, status: { notIn: ["ERSETZT", "ABGELEHNT"] } },
      include: { positionen: true },
      orderBy: { createdAt: "desc" },
    }),
    db.lagerBuchung.findMany({ where: { projektId, art: "PROJEKT" }, include: { artikel: true }, orderBy: { createdAt: "desc" } }),
    db.geraetEinsatz.findMany({ where: { projektId }, include: { geraet: true }, orderBy: { datum: "desc" } }),
    db.zeiteintrag.findMany({ where: { projektId, kategorie: { not: "PAUSE" }, ende: { not: null } }, include: { benutzer: { select: { name: true } } } }),
    // Freigegebene Eingangsrechnungen; Lagerware zählt erst bei der Entnahme
    db.eingangsrechnung.findMany({
      where: { projektId, status: { in: ["FREIGEGEBEN", "BEZAHLT"] }, NOT: { bestellung: { lagerId: { not: null } } } },
      select: { id: true, kostenart: true, netto: true, lieferantName: true, rechnungsnummer: true, datum: true }, orderBy: { datum: "desc" },
    }),
  ]);
  const ek = (art: string) => runden(eingaenge.filter((e) => e.kostenart === art).reduce((s, e) => s + n(e.netto), 0));
  const basis =
    belege.find((b) => b.art === "AUFTRAGSBESTAETIGUNG") ??
    belege.find((b) => b.status === "ANGENOMMEN") ??
    belege[0] ??
    null;
  const soll = basis
    ? summen(basis.positionen, { stundensatz: basis.stundensatz, materialAufschlag: basis.materialAufschlag, fremdAufschlag: basis.fremdAufschlag, mwstSatz: basis.mwstSatz })
    : null;
  const istMaterialLager = runden(entnahmen.reduce((s, e) => s + n(e.wert), 0));
  const istMaterial = runden(istMaterialLager + ek("MATERIAL"));
  const istGeraete = runden(einsaetze.reduce((s, e) => s + n(e.stunden) * n(e.kostensatz), 0) + ek("GERAETE"));
  const istFremd = ek("FREMDLEISTUNG");
  const istSonstiges = ek("SONSTIGES");
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
  return { basis, soll, istMaterial, istGeraete, istGeraeteStunden, istLohnStunden, istLohn, lohnJeMitarbeiter, entnahmen, einsaetze, istFremd, istSonstiges, eingaenge };
}

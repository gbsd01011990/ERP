/** Bezeichnungen und Standardtexte der Rechnungsarten. */
export type RArt = "RECHNUNG" | "ABSCHLAG" | "TEILSCHLUSS" | "SCHLUSS" | "KORREKTUR" | "STORNO";

export const ART_TITEL: Record<RArt, string> = {
  RECHNUNG: "Rechnung",
  ABSCHLAG: "Abschlagsrechnung",
  TEILSCHLUSS: "Teilschlussrechnung",
  SCHLUSS: "Schlussrechnung",
  KORREKTUR: "Rechnungskorrektur",
  STORNO: "Stornorechnung",
};

export const STATUS_TEXT = { ENTWURF: "Entwurf", FESTGESCHRIEBEN: "festgeschrieben", STORNIERT: "storniert" } as const;

type Grundlage = { art: "ANGEBOT" | "AUFTRAGSBESTAETIGUNG"; nummer: string; datum: string } | null;

const grundlageSatz = (g: Grundlage) =>
  g ? ` Grundlage ist ${g.art === "AUFTRAGSBESTAETIGUNG" ? "unsere Auftragsbestätigung" : "unser Angebot"} ${g.nummer} vom ${g.datum}.` : "";

export function standardTexte(art: RArt, o: { grundlage: Grundlage; abschlagNr?: number; planProzent?: number; bezug?: { nummer: string; datum: string } }) {
  const g = grundlageSatz(o.grundlage);
  switch (art) {
    case "ABSCHLAG":
      return o.planProzent != null
        ? { einleitung: `wir berechnen Ihnen den vereinbarten ${o.abschlagNr ?? 1}. Abschlag von ${String(o.planProzent).replace(".", ",")} Prozent der Auftragssumme.${g}`, schlusstext: "Diesen Abschlag ziehen wir in der Schlussrechnung ab." }
        : { einleitung: `für die Arbeiten an Ihrem Bauvorhaben berechnen wir Ihnen den ${o.abschlagNr ?? 1}. Abschlag nach dem Leistungsstand. Die Mengen belegt der beiliegende Mengennachweis.${g}`, schlusstext: "Diesen Abschlag ziehen wir in der Schlussrechnung ab." };
    case "TEILSCHLUSS":
      return { einleitung: `für den abgenommenen Leistungsteil berechnen wir Ihnen die folgenden Leistungen nach Aufmaß.${g}`, schlusstext: "Diese Teilschlussrechnung ziehen wir in der Schlussrechnung ab." };
    case "SCHLUSS":
      return { einleitung: `für die abgeschlossenen Arbeiten an Ihrem Bauvorhaben stellen wir Ihnen die Schlussrechnung nach Aufmaß. Bereits berechnete Abschläge ziehen wir einzeln ab.${g}`, schlusstext: null };
    case "KORREKTUR":
      return { einleitung: `wir berichtigen unsere Rechnung ${o.bezug?.nummer ?? ""} vom ${o.bezug?.datum ?? ""} wie folgt.`, schlusstext: null };
    case "STORNO":
      return { einleitung: `wir stornieren unsere Rechnung ${o.bezug?.nummer ?? ""} vom ${o.bezug?.datum ?? ""} vollständig.`, schlusstext: null };
    default:
      return { einleitung: `für die ausgeführten Arbeiten berechnen wir Ihnen die folgenden Leistungen.${g}`, schlusstext: null };
  }
}

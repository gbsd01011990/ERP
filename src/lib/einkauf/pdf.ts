import "server-only";
import { datum } from "../format";
import { n, runden } from "../kalkulation";
import { pdfErzeugen } from "../pdf";
import { empfaengerZeilen } from "../vorlagen";
import type { GeladeneBestellung } from "../dienste/einkauf";

/** Bestellung als PDF im CD der Firma. */
export function bestellungDaten(x: GeladeneBestellung) {
  const l = x.lieferant;
  const adr = l?.adressen?.find((a) => a.art === "HAUPT") ?? l?.adressen?.[0];
  const netto = runden(x.positionen.reduce((s, p) => s + runden(n(p.menge) * n(p.preis)), 0));
  const zusatz: [string, string][] = [];
  if (x.liefertermin) zusatz.push(["Liefertermin", datum(x.liefertermin)]);
  if (x.projekt) zusatz.push(["Projekt", x.projekt.nummer]);
  const lieferung = x.lieferadresse ?? (x.lager ? `${x.lager.name}${x.lager.adresse ? `, ${x.lager.adresse}` : ""}` : null);
  return {
    firma: x.firma.kuerzel, dokumentart: "Bestellung", belegnummer: x.nummer ?? "ENTWURF", datum: datum(x.bestelltAm ?? new Date()), gueltigBis: "",
    empfaenger: l ? empfaengerZeilen(x.firma.kuerzel, l, adr ?? undefined) : ["(Lieferant fehlt)"], kundennummer: "", ansprechpartner: x.bestelltVon?.name ?? x.erstelltVon?.name ?? "",
    betreff: `Bestellung ${x.nummer ?? ""} – ${x.betreff}`, anrede: "Sehr geehrte Damen und Herren,",
    einleitung: "wir bestellen zu Ihren uns bekannten Konditionen die folgenden Positionen.",
    vorbemerkung: "", verbraucher: false, infosZusatz: zusatz, vortext: [...zusatz.map(([a, b]) => `${a}: ${b}`), ...(lieferung ? [`Lieferung an: ${lieferung}`] : [])],
    schlusstext: [
      lieferung ? `Lieferung an: ${lieferung}.` : "",
      `Bitte geben Sie auf Lieferschein und Rechnung unsere Bestellnummer ${x.nummer ?? ""} an. Weichen Preis, Menge oder Termin ab, melden Sie sich bitte vor der Lieferung.`,
      x.notiz ?? "",
    ].filter(Boolean).join("\n\n"),
    mengennachweis: false,
    positionen: x.positionen.map((p, i) => ({
      art: "POSITION", posNr: String(i + 1), kurztext: p.text, langtext: p.artNr ? `Ihre Art.-Nr. ${p.artNr}` : "",
      menge: n(p.menge), einheit: p.einheit, einzelpreis: n(p.preis), gesamt: runden(n(p.menge) * n(p.preis)), bedarf: false,
    })),
    summen: { netto, mwst: runden(netto * 0.19), brutto: runden(netto * 1.19), mwstSatz: 19, lohnanteilBrutto: 0 },
    rechnung: { abrechnung: [{ label: "Bestellwert netto", betrag: netto }], weitere: [], vorrechnungen: [], hinweise: [], zahlung: "" },
  };
}

export const bestellungPdf = (x: GeladeneBestellung) => pdfErzeugen(bestellungDaten(x) as never);

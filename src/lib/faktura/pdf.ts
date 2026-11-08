import "server-only";
import { datum } from "../format";
import { n, nummerieren } from "../kalkulation";
import { pdfErzeugen } from "../pdf";
import { berechnung, empfaengerAus, type GeladeneRechnung } from "../dienste/rechnungen";
import { aufmassZeileWert, faelligAm } from "./berechnung";
import { ART_TITEL } from "./texte";

const eur = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const zahl3 = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 3 });
const prozent = (v: unknown) => String(n(v as number)).replace(".", ",");

export const rechnungsName = (r: Pick<GeladeneRechnung, "art" | "nummer">) =>
  `${ART_TITEL[r.art].replace(/\s/g, "_")}_${r.nummer ?? "Entwurf"}.pdf`;

function zeitraum(r: GeladeneRechnung) {
  if (r.leistungVon && r.leistungBis && datum(r.leistungVon) !== datum(r.leistungBis)) return `${datum(r.leistungVon)} – ${datum(r.leistungBis)}`;
  const d = r.leistungBis ?? r.leistungVon;
  return d ? datum(d) : "";
}

/** JSON für pdf/erzeugen.py (Rechnung oder Mengennachweis). */
export function rechnungDaten(r: GeladeneRechnung, mengennachweis = false) {
  const be = berechnung(r);
  const emp = empfaengerAus(r);
  const titel = mengennachweis ? "Mengennachweis" : ART_TITEL[r.art];
  const nummer = r.nummer ?? "ENTWURF";
  const titelNr = r.art === "ABSCHLAG" && r.abschlagNr ? `${r.abschlagNr}. ${ART_TITEL.ABSCHLAG}` : ART_TITEL[r.art];

  const zusatz: [string, string][] = [];
  if (mengennachweis) zusatz.push(["zur Rechnung", nummer]);
  const lz = zeitraum(r);
  if (lz) zusatz.push(["Leistung", lz]);
  if (r.kundenReferenz) zusatz.push(["Ihre Referenz", r.kundenReferenz]);
  if (r.bezug?.nummer) zusatz.push(["zu Rechnung", `${r.bezug.nummer} vom ${datum(r.bezug.datum)}`]);

  const positionen = nummerieren(r.positionen).map((p, i) => ({
    art: p.art, posNr: p.posNr, kurztext: p.kurztext,
    langtext: [p.langtext, p.auftragsMenge != null && r.art !== "STORNO" && Math.abs(n(p.auftragsMenge) - n(p.menge)) > 1e-6 ? `Auftrag: ${zahl3(n(p.auftragsMenge))} ${p.einheit}` : ""].filter(Boolean).join("\n"),
    menge: n(p.menge), einheit: p.einheit, einzelpreis: n(p.einzelpreis), gesamt: be.zeilen[i]?.gesamt ?? 0, bedarf: false,
    aufmass: p.aufmass.map((z) => {
      const faktoren = [z.anzahl, z.laenge, z.breite, z.hoehe].filter((v) => v != null).map((v) => zahl3(n(v)));
      const ansatz = z.formel ?? faktoren.join(" × ");
      let wert = "";
      try { wert = zahl3(aufmassZeileWert(z)); } catch { wert = "?"; }
      const teile = [z.datum ? datum(z.datum) : "", z.text ?? "", `${z.abzug ? "Abzug " : ""}${ansatz} = ${wert}`].filter(Boolean);
      return [teile.join("  ·  "), z.reb ? `REB: ${z.reb.replace(/\n/g, " | ")}` : ""].filter(Boolean).join("\n");
    }),
  }));

  const steuerLabel = r.steuerschuldUmkehr ? "Umsatzsteuer (§ 13b UStG)" : `zzgl. ${prozent(be.mwstSatz)} % USt.`;
  const abrechnung: { label: string; betrag: number }[] = [];
  const mitAbzug = r.verrechnungen.length > 0;
  abrechnung.push({ label: mitAbzug ? (r.art === "ABSCHLAG" ? "Leistungsstand netto" : "Gesamtleistung netto") : "Summe netto", betrag: be.leistung.netto });
  abrechnung.push({ label: steuerLabel, betrag: be.leistung.mwst });
  abrechnung.push({ label: mitAbzug ? (r.art === "ABSCHLAG" ? "Leistungsstand brutto" : "Gesamtleistung brutto") : "Rechnungsbetrag brutto", betrag: be.leistung.brutto });
  if (mitAbzug) {
    abrechnung.push({ label: "abzgl. verrechnete Rechnungen", betrag: -be.abzug.brutto });
    abrechnung.push({ label: "Rechnungsbetrag brutto", betrag: be.brutto });
  }
  if (be.einbehaltFreigabe) abrechnung.push({ label: "zzgl. Einbehalte aus Abschlägen", betrag: be.einbehaltFreigabe });
  if (be.einbehalt) abrechnung.push({ label: `abzgl. Sicherheitseinbehalt ${prozent(r.einbehaltProzent)} %`, betrag: -be.einbehalt });
  if (be.einbehalt || be.einbehaltFreigabe) abrechnung.push({ label: be.zahlbetrag < 0 ? "Erstattungsbetrag" : "Zahlbetrag", betrag: be.zahlbetrag });

  const vorrechnungen = r.verrechnungen.map((v) => {
    const art = v.vor.art === "ABSCHLAG" && v.vor.abschlagNr ? `${v.vor.abschlagNr}. Abschlagsrechnung` : ART_TITEL[v.vor.art];
    return `${art} ${v.vor.nummer} vom ${datum(v.vor.datum)}: netto ${eur(n(v.netto))} €, USt. ${eur(n(v.mwst))} €, brutto ${eur(n(v.brutto))} €`;
  });
  if (mitAbzug) vorrechnungen.push(`Nach Abzug verbleiben netto ${eur(be.netto)} € und ${r.steuerschuldUmkehr ? "keine Umsatzsteuer" : `Umsatzsteuer ${eur(be.mwst)} €`}.`);

  const hinweise: { titel: string; text: string }[] = [];
  if (r.steuerschuldUmkehr) hinweise.push({ titel: "Steuerschuldnerschaft des Leistungsempfängers", text: "Die Umsatzsteuer für diese Bauleistung schulden Sie als Leistungsempfänger nach § 13b UStG." });
  if (r.art === "ABSCHLAG" && !r.leistungVon && !r.leistungBis) hinweise.push({ titel: "Leistungszeitpunkt", text: "Die Leistung ist noch nicht erbracht, für die Umsatzsteuer zählt der Tag Ihrer Zahlung." });
  if (r.s35a && be.lohnBrutto) {
    let t = `In dieser Rechnung sind Arbeits-, Maschinen- und Fahrtkosten von ${eur(be.lohnBrutto)} € brutto enthalten (darin Umsatzsteuer ${eur(be.lohnMwst)} €).`;
    if (Math.abs(be.lohnGesamtBrutto - be.lohnBrutto) > 0.005) t += ` Für die Gesamtleistung betragen sie ${eur(be.lohnGesamtBrutto)} €, davon haben wir ${eur(be.lohnGesamtBrutto - be.lohnBrutto)} € in den verrechneten Rechnungen ausgewiesen.`;
    t += " Die Ermäßigung setzt voraus, dass Sie den Betrag überweisen. Barzahlung erkennt das Finanzamt nicht an.";
    hinweise.push({ titel: "Steuerermäßigung nach § 35a EStG", text: t });
  }

  let zahlung = "";
  if (r.art === "STORNO") zahlung = be.zahlbetrag < 0 ? `Bereits gezahlte Beträge erstatten wir Ihnen auf Ihr Konto.` : "";
  else if (be.zahlbetrag > 0) {
    const ziel = r.zahlungszielTage === 0 ? "sofort und ohne Abzug" : `bis zum ${datum(faelligAm(r.datum, r.zahlungszielTage))}`;
    zahlung = `Bitte überweisen Sie ${eur(be.zahlbetrag)} € ${ziel} und geben Sie die Rechnungsnummer ${nummer} als Verwendungszweck an.`;
    if (n(r.skontoProzent) > 0 && r.skontoTage > 0) {
      zahlung += ` Bei Zahlung bis zum ${datum(faelligAm(r.datum, r.skontoTage))} ziehen Sie ${prozent(r.skontoProzent)} % Skonto ab (${eur(be.skonto)} €) und überweisen ${eur(be.zahlbetrag - be.skonto)} €.`;
    }
  } else if (be.zahlbetrag < 0) zahlung = `Den Betrag von ${eur(-be.zahlbetrag)} € erstatten wir Ihnen auf Ihr Konto.`;

  return {
    firma: r.firma.kuerzel,
    dokumentart: mengennachweis ? titel : titelNr,
    belegnummer: nummer,
    datum: datum(r.datum),
    gueltigBis: "",
    empfaenger: emp.zeilen,
    kundennummer: emp.kundennummer,
    ansprechpartner: r.erstelltVon?.name ?? "",
    betreff: mengennachweis ? `Mengennachweis zur ${titelNr} ${nummer} – ${r.betreff}` : r.betreff,
    anrede: mengennachweis ? "" : r.anrede ?? "",
    einleitung: mengennachweis ? "Die Mengen sind nach den Abrechnungsregeln der VOB/C und REB ermittelt. Jede Zeile nennt Datum, Ansatz und Ergebnis." : r.einleitung ?? "",
    vorbemerkung: "",
    schlusstext: mengennachweis ? "" : r.schlusstext ?? "",
    verbraucher: emp.verbraucher,
    infosZusatz: zusatz,
    vortext: zusatz.map(([l, w]) => `${l}: ${w}`),
    mengennachweis,
    positionen,
    summen: { netto: be.leistung.netto, mwst: be.leistung.mwst, brutto: be.leistung.brutto, mwstSatz: be.mwstSatz, lohnanteilBrutto: 0 },
    rechnung: mengennachweis ? null : { abrechnung, vorrechnungen, vorrechnungenTitel: "Verrechnete Rechnungen", hinweise, zahlung },
  };
}

export const rechnungPdf = (r: GeladeneRechnung) => pdfErzeugen(rechnungDaten(r) as never);
export const mengennachweisPdf = (r: GeladeneRechnung) => pdfErzeugen(rechnungDaten(r, true) as never);

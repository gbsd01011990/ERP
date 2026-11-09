/**
 * Erzeugt typische Rechnungsfälle als XRechnung (CII) in ein Verzeichnis – für die Prüfung mit dem
 * KoSIT-Validator in GitHub Actions:  npx tsx scripts/erechnung-beispiele.ts <ziel> [XRECHNUNG|EN16931]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rechnungBerechnen, type RPos } from "../src/lib/faktura/berechnung";
import { ciiErzeugen, type CiiRechnung, type CiiKaeufer, type CiiProfil } from "../src/lib/faktura/cii";
import { VERKAEUFER } from "../src/lib/faktura/stammdaten";

const ziel = process.argv[2] ?? "erechnung-beispiele";
const profil = (process.argv[3] ?? "XRECHNUNG") as CiiProfil;
mkdirSync(ziel, { recursive: true });

const kaeufer: CiiKaeufer = { name: "Musterbau GmbH", strasse: "Lindenweg 4", plz: "14542", ort: "Werder (Havel)", land: "DE", email: "rechnung@musterbau.example", ustId: "DE123456789", kundennummer: "K-1001", kontaktperson: "Erika Muster" };
const tag = (s: string) => new Date(`${s}T12:00:00Z`);
const basis: CiiRechnung = { nummer: "2026-900", art: "RECHNUNG", datum: tag("2026-11-09"), leistungVon: tag("2026-10-01"), leistungBis: tag("2026-10-31"), kundenReferenz: "04011000-1234512345-06", steuerschuldUmkehr: false, zahlungszielTage: 14, skontoProzent: 0, skontoTage: 0, einbehaltProzent: 0, bezug: null, hinweise: ["Rechnung BV Werder – Neuanlage Vorgarten"] };
const pos = (kurztext: string, menge: number, einheit: string, ep: number, kostenart: RPos["kostenart"] = "LOHN") => ({ art: "POSITION" as const, posNr: "", kurztext, langtext: null, menge, einheit, einzelpreis: ep, kostenart, lohnEp: 0 });

function fall(name: string, r: CiiRechnung, positionen: ReturnType<typeof pos>[], vor: { netto: number; mwst: number; brutto: number; einbehalt: number; lohnBrutto: number }[] = [], k = kaeufer, mwst = 19) {
  const be = rechnungBerechnen(positionen.map((p) => ({ ...p })), { art: r.art, mwstSatz: mwst, steuerschuldUmkehr: r.steuerschuldUmkehr, einbehaltProzent: r.einbehaltProzent, skontoProzent: r.skontoProzent }, vor);
  const cii = positionen.map((p, i) => ({ ...p, posNr: `01.${String(i + 1).padStart(2, "0")}`, gesamt: be.zeilen[i].gesamt }));
  writeFileSync(path.join(ziel, `${name}.xml`), ciiErzeugen({ profil, verkaeufer: VERKAEUFER.GBSD, kaeufer: k, rechnung: r, positionen: cii, berechnung: be }));
  return be;
}

const lv = [pos("Oberboden abtragen", 42.5, "m²", 7.3), pos("Hainbuchenhecke pflanzen", 30, "Stk.", 29.48, "MATERIAL"), pos("Baustelleneinrichtung", 1, "psch", 180, "FAHRT")];
fall("01-rechnung", basis, lv);
fall("02-rechnung-skonto-nachlass", { ...basis, nummer: "2026-901", skontoProzent: 2, skontoTage: 7 }, [...lv, pos("Nachlass", 1, "psch", -50)]);
const a1 = fall("03-abschlag-1", { ...basis, nummer: "2026-902", art: "ABSCHLAG", leistungVon: null, leistungBis: null, einbehaltProzent: 10 }, [pos("30 % Abschlag auf Arbeitsleistung", 1, "psch", 358.4)]);
const v1 = { netto: a1.netto, mwst: a1.mwst, brutto: a1.brutto, einbehalt: a1.einbehalt, lohnBrutto: a1.lohnBrutto };
const a2 = fall("04-abschlag-2-kumuliert", { ...basis, nummer: "2026-903", art: "ABSCHLAG", einbehaltProzent: 10 }, [pos("Oberboden abtragen", 30, "m²", 7.3), pos("Hainbuchenhecke pflanzen", 20, "Stk.", 29.48, "MATERIAL")], [v1]);
const v2 = { netto: a2.netto, mwst: a2.mwst, brutto: a2.brutto, einbehalt: a2.einbehalt, lohnBrutto: a2.lohnBrutto };
fall("05-schluss", { ...basis, nummer: "2026-904", art: "SCHLUSS", einbehaltProzent: 5, skontoProzent: 2, skontoTage: 10 }, lv, [v1, v2]);
fall("06-paragraf-13b", { ...basis, nummer: "2026-905", steuerschuldUmkehr: true, hinweise: ["Steuerschuldnerschaft des Leistungsempfängers"] }, lv, [], kaeufer, 0);
fall("07-storno", { ...basis, nummer: "2026-906", art: "STORNO", bezug: { nummer: "2026-900", datum: tag("2026-11-09") }, zahlungszielTage: 0 }, lv.map((p) => ({ ...p, menge: -p.menge })));
fall("08-korrektur-gutschrift", { ...basis, nummer: "2026-907", art: "KORREKTUR", bezug: { nummer: "2026-900", datum: tag("2026-11-09") } }, [pos("Minderung Hecke (2 Pflanzen weniger)", -2, "Stk.", 29.48, "MATERIAL")]);
fall("09-korrektur-nachberechnung", { ...basis, nummer: "2026-908", art: "KORREKTUR", bezug: { nummer: "2026-900", datum: tag("2026-11-09") } }, [pos("Mehrmenge Oberboden", 5, "m²", 7.3)]);
console.log(`9 Fälle (${profil}) in ${ziel}`);

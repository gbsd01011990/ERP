import { test } from "node:test";
import assert from "node:assert/strict";
import { rechnungBerechnen } from "../../src/lib/faktura/berechnung";
import { ciiErzeugen, einheitCode, xrechnungMaengel, type CiiRechnung, type CiiKaeufer } from "../../src/lib/faktura/cii";
import { VERKAEUFER } from "../../src/lib/faktura/stammdaten";

const k: CiiKaeufer = { name: "Musterbau GmbH", strasse: "Lindenweg 4", plz: "14542", ort: "Werder", land: "DE", email: "r@m.example", ustId: null, kundennummer: "K1", kontaktperson: null };
const r: CiiRechnung = { nummer: "2026-1", art: "SCHLUSS", datum: new Date("2026-11-09T12:00:00Z"), leistungVon: new Date("2026-10-01T12:00:00Z"), leistungBis: new Date("2026-10-31T12:00:00Z"), kundenReferenz: null, steuerschuldUmkehr: false, zahlungszielTage: 14, skontoProzent: 2, skontoTage: 7, einbehaltProzent: 5, bezug: null, hinweise: [] };
const wert = (xml: string, tag: string) => Number(new RegExp(`<ram:${tag}[^>]*>([^<]+)<`).exec(xml)?.[1]);

test("Schlussrechnung: Vorauszahlung, Zahlbetrag, Skonto-Syntax, Einbehalt als Hinweis", () => {
  const pos = [{ art: "POSITION" as const, menge: 100, einzelpreis: 25, kostenart: "LOHN" as const, lohnEp: 0 }];
  const be = rechnungBerechnen(pos, { art: "SCHLUSS", mwstSatz: 19, steuerschuldUmkehr: false, einbehaltProzent: 5, skontoProzent: 2 }, [{ netto: 1000, mwst: 190, brutto: 1190, einbehalt: 0, lohnBrutto: 0 }]);
  const xml = ciiErzeugen({ profil: "XRECHNUNG", verkaeufer: VERKAEUFER.GBSD, kaeufer: k, rechnung: r, positionen: [{ art: "POSITION", posNr: "01", kurztext: "Arbeit", langtext: null, menge: 100, einheit: "h", einzelpreis: 25, gesamt: 2500 }], berechnung: be });
  assert.equal(wert(xml, "GrandTotalAmount"), 2975);
  assert.equal(wert(xml, "TotalPrepaidAmount"), 1190);
  assert.equal(wert(xml, "DuePayableAmount"), 1785);
  assert.match(xml, /<ram:TypeCode>877<\/ram:TypeCode>/);
  assert.match(xml, /#SKONTO#TAGE=7#PROZENT=2\.00#\n/);
  assert.match(xml, /Sicherheitseinbehalt 5 %: 148,75 EUR/);
  assert.match(xml, /xrechnung_3\.0/);
  assert.match(xml, /unitCode="HUR"/);
  assert.match(xml, /<ram:BillingSpecifiedPeriod>/);
});

test("Storno wird Gutschrift mit positiven Beträgen; § 13b wird Kategorie AE", () => {
  const pos = [{ art: "POSITION" as const, menge: -2, einzelpreis: 50, kostenart: "LOHN" as const, lohnEp: 0 }];
  const be = rechnungBerechnen(pos, { art: "STORNO", mwstSatz: 19, steuerschuldUmkehr: true, einbehaltProzent: 0, skontoProzent: 0 });
  const xml = ciiErzeugen({ profil: "EN16931", verkaeufer: VERKAEUFER.KUD, kaeufer: { ...k, ustId: "DE123456789" }, rechnung: { ...r, art: "STORNO", steuerschuldUmkehr: true, bezug: { nummer: "2026-0", datum: r.datum } }, positionen: [{ art: "POSITION", posNr: "1", kurztext: "x", langtext: null, menge: -2, einheit: "Stk.", einzelpreis: 50, gesamt: -100 }], berechnung: be });
  assert.match(xml, /<ram:TypeCode>381<\/ram:TypeCode>/);
  assert.equal(wert(xml, "DuePayableAmount"), 100);
  assert.match(xml, /<ram:CategoryCode>AE<\/ram:CategoryCode>/);
  assert.match(xml, /VATEX-EU-AE/);
  assert.match(xml, /<ram:IssuerAssignedID>2026-0<\/ram:IssuerAssignedID>/);
  assert.doesNotMatch(xml, /xrechnung/);
});

test("Einheiten und Pflichtangaben", () => {
  assert.equal(einheitCode("m²"), "MTK"); assert.equal(einheitCode("Stk."), "H87"); assert.equal(einheitCode("psch"), "LS"); assert.equal(einheitCode("Fuhre"), "C62");
  assert.deepEqual(xrechnungMaengel(VERKAEUFER.GBSD, { ...k, email: null }, { ...r, steuerschuldUmkehr: true }), ["E-Mail-Adresse des Kunden (elektronische Adresse BT-49)", "USt-IdNr. des Kunden (Pflicht bei § 13b)"]);
  assert.deepEqual(xrechnungMaengel(VERKAEUFER.GBSD, k, r), []);
});

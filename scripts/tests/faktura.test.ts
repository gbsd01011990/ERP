import { test } from "node:test";
import assert from "node:assert/strict";
import { rechnungBerechnen, beguenstigtJeEinheit, aufmassMenge, kostenartAusKalkulation, type RPos, type Kopf } from "../../src/lib/faktura/berechnung";
import { formelBerechnen } from "../../src/lib/faktura/formel";
import { nummerFormatieren, naechsteVorschau } from "../../src/lib/nummern";

const pos = (p: Partial<RPos>): RPos => ({ art: "POSITION", menge: 1, einzelpreis: 0, kostenart: "MATERIAL", lohnEp: 0, ...p });
const kopf = (k: Partial<Kopf> = {}): Kopf => ({ art: "RECHNUNG", mwstSatz: 19, steuerschuldUmkehr: false, einbehaltProzent: 0, skontoProzent: 0, ...k });

test("Abschlag nach Zahlungsplan aus Nettobeträgen (Beispiel aus dem Rechnungs-Skill)", () => {
  const r = rechnungBerechnen([
    pos({ einzelpreis: 340, kostenart: "LOHN" }),
    pos({ einzelpreis: 22.5, kostenart: "FAHRT" }),
    pos({ einzelpreis: 214.2, kostenart: "MATERIAL" }),
  ], kopf({ art: "ABSCHLAG" }));
  assert.equal(r.netto, 576.7);
  assert.equal(r.mwst, 109.57);
  assert.equal(r.brutto, 686.27);
  assert.equal(r.lohnBrutto, 431.38); // (340 + 22,50) × 1,19
});

test("Kumulierter Abschlag zieht frühere Abschläge mit ihrer Steuer ab", () => {
  const erster = rechnungBerechnen([pos({ menge: 40, einzelpreis: 25, kostenart: "LOHN" })], kopf({ art: "ABSCHLAG", einbehaltProzent: 10 }));
  assert.equal(erster.brutto, 1190);
  assert.equal(erster.einbehalt, 119);
  assert.equal(erster.zahlbetrag, 1071);
  const vor = { netto: erster.netto, mwst: erster.mwst, brutto: erster.brutto, einbehalt: erster.einbehalt, lohnBrutto: erster.lohnBrutto };
  const zweiter = rechnungBerechnen([pos({ menge: 100, einzelpreis: 25, kostenart: "LOHN" })], kopf({ art: "ABSCHLAG", einbehaltProzent: 10 }), [vor]);
  assert.deepEqual(zweiter.leistung, { netto: 2500, mwst: 475, brutto: 2975 });
  assert.equal(zweiter.netto, 1500);
  assert.equal(zweiter.mwst, 285);
  assert.equal(zweiter.brutto, 1785);
  assert.equal(zweiter.einbehalt, 178.5);
  assert.equal(zweiter.einbehaltFreigabe, 0);
  assert.equal(zweiter.lohnBrutto, 1785);
});

test("Schlussrechnung: Abschläge ab, Abschlagseinbehalte frei, Gewährleistungseinbehalt auf Gesamtleistung", () => {
  const vor = [
    { netto: 1000, mwst: 190, brutto: 1190, einbehalt: 119, lohnBrutto: 1190 },
    { netto: 1500, mwst: 285, brutto: 1785, einbehalt: 178.5, lohnBrutto: 1785 },
  ];
  const r = rechnungBerechnen([pos({ menge: 120, einzelpreis: 25, kostenart: "LOHN" })], kopf({ art: "SCHLUSS", einbehaltProzent: 5, skontoProzent: 2 }), vor);
  assert.equal(r.leistung.brutto, 3570);
  assert.equal(r.brutto, 595);
  assert.equal(r.einbehaltFreigabe, 297.5);
  assert.equal(r.einbehalt, 178.5); // 5 % von 3.570
  assert.equal(r.zahlbetrag, 714); // 595 + 297,50 − 178,50
  assert.equal(r.skonto, 14.28);
  assert.equal(r.lohnGesamtBrutto, 3570);
  assert.equal(r.lohnBrutto, 595);
});

test("§ 13b: keine Umsatzsteuer", () => {
  const r = rechnungBerechnen([pos({ menge: 2, einzelpreis: 100 })], kopf({ steuerschuldUmkehr: true }));
  assert.equal(r.mwst, 0);
  assert.equal(r.brutto, 200);
  assert.equal(r.mwstSatz, 0);
});

test("Gruppensummen über mehrere Ebenen, Texte zählen nicht", () => {
  const r = rechnungBerechnen([
    pos({ art: "GRUPPE", ebene: 1 }), pos({ art: "GRUPPE", ebene: 2 }), pos({ menge: 2, einzelpreis: 10 }),
    pos({ art: "TEXT" }), pos({ art: "GRUPPE", ebene: 2 }), pos({ menge: 1, einzelpreis: 5 }),
  ], kopf());
  assert.deepEqual(r.gruppen, [25, 20, 5]);
  assert.equal(r.netto, 25);
});

test("Begünstigter Anteil je Kostenart", () => {
  assert.equal(beguenstigtJeEinheit({ kostenart: "MASCHINE", einzelpreis: 80, lohnEp: 0 }), 80);
  assert.equal(beguenstigtJeEinheit({ kostenart: "MATERIAL", einzelpreis: 80, lohnEp: 50 }), 0);
  assert.equal(beguenstigtJeEinheit({ kostenart: "GEMISCHT", einzelpreis: 80, lohnEp: 50 }), 50);
  assert.equal(beguenstigtJeEinheit({ kostenart: "GEMISCHT", einzelpreis: 40, lohnEp: 50 }), 40);
  assert.deepEqual(kostenartAusKalkulation({ lohn: 30, material: 12, geraete: 5, fremd: 0 }, 47), { kostenart: "GEMISCHT", lohnEp: 35 });
  assert.deepEqual(kostenartAusKalkulation({ lohn: 0, material: 12, geraete: 0, fremd: 0 }, 12), { kostenart: "MATERIAL", lohnEp: 0 });
  assert.deepEqual(kostenartAusKalkulation({ lohn: 60, material: 0, geraete: 0, fremd: 0 }, 60), { kostenart: "LOHN", lohnEp: 60 });
});

test("Storno: negative Mengen ergeben negative Beträge", () => {
  const r = rechnungBerechnen([pos({ menge: -3, einzelpreis: 50, kostenart: "LOHN" })], kopf({ art: "STORNO", skontoProzent: 2 }));
  assert.equal(r.brutto, -178.5);
  assert.equal(r.skonto, 0);
  assert.equal(r.lohnBrutto, -178.5);
});

test("REB-Formeln", () => {
  assert.equal(formelBerechnen("12,5*3,2 - 2*(0,8*0,8)"), 38.72);
  assert.equal(formelBerechnen("2^3+1"), 9);
  assert.equal(formelBerechnen("PI*0,5^2"), 0.785);
  assert.equal(formelBerechnen("WURZEL(9)*2"), 6);
  assert.equal(formelBerechnen("3 x 4"), 12);
  assert.throws(() => formelBerechnen("2*(3"));
  assert.throws(() => formelBerechnen("1/0"));
  assert.throws(() => formelBerechnen("alert(1)"));
});

test("Mengennachweis: Formel vor Faktoren, Abzüge negativ", () => {
  assert.equal(aufmassMenge([
    { formel: "10*2", anzahl: 99, laenge: null, breite: null, hoehe: null, abzug: false },
    { anzahl: 2, laenge: 1.5, breite: null, hoehe: null, abzug: true },
  ]), 17);
});

test("Nummernkreis mit Jahr und Jahreswechsel", () => {
  assert.equal(nummerFormatieren({ praefix: "2026-", stellen: 3 }, 114, 2026), "2026-114");
  assert.equal(nummerFormatieren({ praefix: "RE-{JJJJ}-", stellen: 4 }, 7, 2027), "RE-2027-0007");
  assert.equal(nummerFormatieren({ praefix: "{JJ}/", stellen: 2 }, 3, 2027), "27/03");
  const k = { praefix: "RE-{JJJJ}-", stellen: 3, naechste: 57, jahresweise: true, jahr: 2026 };
  assert.equal(naechsteVorschau(k, new Date("2026-12-31T12:00:00Z")), "RE-2026-057");
  assert.equal(naechsteVorschau(k, new Date("2027-01-02T12:00:00Z")), "RE-2027-001");
});

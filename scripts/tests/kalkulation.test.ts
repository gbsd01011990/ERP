import { test } from "node:test";
import assert from "node:assert/strict";
import { einzelpreisAnteile, summen, nummerieren, parseZahl, aufmassSumme, type Pos } from "../../src/lib/kalkulation";

const S = { stundensatz: 60, materialAufschlag: 20, fremdAufschlag: 10, mwstSatz: 19 };
const pos = (p: Partial<Pos>): Pos => ({ art: "POSITION", menge: 1, einzelpreis: 0, preisFest: false, bedarf: false, minuten: 0, materialEk: 0, geraete: 0, fremdEk: 0, ...p });

test("Einzelpreis aus Lohn, Material, Gerät, Fremdleistung", () => {
  const a = einzelpreisAnteile({ minuten: 30, materialEk: 10, geraete: 5, fremdEk: 100 }, S);
  assert.equal(a.lohn, 30);
  assert.equal(a.material, 12);
  assert.equal(a.summe, 30 + 12 + 5 + 110);
});

test("Summen, Bedarfsposition, fester Preis, Lohnanteil", () => {
  const r = summen([
    pos({ art: "GRUPPE" }),
    pos({ menge: 10, minuten: 12, materialEk: 5 }),          // EP 12 + 6 = 18 → 180, Lohn 120
    pos({ menge: 2, einzelpreis: 50, preisFest: true, minuten: 60 }), // 100, Lohn je min(60,50)=50 → 100
    pos({ menge: 3, minuten: 60, bedarf: true }),            // nicht in Summe
    pos({ art: "TEXT" }),
  ], S);
  assert.equal(r.netto, 280);
  assert.equal(r.mwst, 53.2);
  assert.equal(r.brutto, 333.2);
  assert.equal(r.lohnanteilNetto, 220);
  assert.equal(r.stunden, 4);
  assert.deepEqual(r.gruppen.map((g) => g.summe), [280]);
});

test("Nummerierung", () => {
  const r = nummerieren([{ art: "GRUPPE" }, { art: "POSITION" }, { art: "TEXT" }, { art: "POSITION" }, { art: "GRUPPE" }, { art: "POSITION" }]);
  assert.deepEqual(r.map((x) => x.posNr), ["01", "01.01", "", "01.02", "02", "02.01"]);
});

test("Deutsche Zahlen", () => {
  assert.equal(parseZahl("1.234,50"), 1234.5);
  assert.equal(parseZahl("12.5"), 12.5);
  assert.equal(parseZahl(""), 0);
});

test("Aufmaß mit leeren Faktoren und Abzug", () => {
  assert.equal(aufmassSumme([
    { anzahl: null, laenge: 8.5, breite: 5, hoehe: null, abzug: false },   // 42,5
    { anzahl: 2, laenge: 1.2, breite: 1.5, hoehe: null, abzug: true },     // −3,6
    { anzahl: 3, laenge: null, breite: null, hoehe: null, abzug: false },  // 3
  ]), 41.9);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefen, zuordnen, type PruefEingabe } from "../../src/lib/einkauf/pruefung";

const basis = (x: Partial<PruefEingabe> = {}): PruefEingabe => ({
  kopf: {
    rechnungsnummer: "RE-55", datum: "2026-11-05", leistungsdatum: "2026-11-03", netto: 500, mwst: 95, brutto: 595, vorauszahlung: 0, zahlbetrag: 595, summePositionen: 500,
    iban: "DE02120300000000202051", lieferant: { name: "Baustoff Nord GmbH", ustId: "DE111111111", steuernummer: null, strasse: "Weg 1", plz: "14542", ort: "Werder" }, kaeufer: { name: "GBSD GmbH" },
  },
  steuern: [{ basis: 500, betrag: 95, kategorie: "S", satz: 19 }],
  positionen: [{ nr: 1, artNr: "SPL-032", text: "Splitt 0/32", menge: 10, preis: 30, gesamt: 300 }, { nr: 2, artNr: null, text: "Rasengitter", menge: 20, preis: 10, gesamt: 200 }],
  elektronisch: true, xsdOk: true, firmaName: "GBSD GmbH", doppelt: null, bekannteIbans: ["DE02 1203 0000 0000 2020 51"],
  bestellung: { nummer: "GB-BE-0001", positionen: [
    { id: "a", artNr: "spl-032", text: "Splitt 0/32 lose", menge: 10, geliefert: 10, berechnetVorher: 0, preis: 30 },
    { id: "b", artNr: null, text: "Rasengitter", menge: 20, geliefert: 20, berechnetVorher: 0, preis: 10 },
  ] },
  toleranzProzent: 2, ...x,
});

test("Saubere Rechnung zur Bestellung: alles grün", () => {
  const r = pruefen(basis());
  assert.equal(r.ergebnis, "ok", JSON.stringify(r.regeln.filter((x) => x.status !== "ok")));
  assert.deepEqual(r.zuordnung, { 1: "a", 2: "b" });
});

test("Dreiweg-Abgleich: mehr berechnet als geliefert/bestellt, Preis zu hoch, nicht bestellt", () => {
  const b = basis();
  b.bestellung!.positionen[0].geliefert = 6;
  b.positionen = [{ ...b.positionen[0] }, { nr: 2, artNr: null, text: "Rasengitter", menge: 25, preis: 10.5, gesamt: 262.5 }, { nr: 3, artNr: null, text: "Frachtkosten", menge: 1, preis: 37.5, gesamt: 37.5 }];
  b.kopf.netto = 600; b.kopf.summePositionen = 600; b.kopf.mwst = 114; b.kopf.brutto = 714; b.kopf.zahlbetrag = 714; b.steuern = [{ basis: 600, betrag: 114, kategorie: "S", satz: 19 }];
  const r = pruefen(b);
  const t = r.regeln.map((x) => `${x.status}: ${x.text}`).join("\n");
  assert.match(t, /warnung: „Splitt 0\/32 lose“: 10 berechnet, aber erst 6 als geliefert/);
  assert.match(t, /fehler: „Rasengitter“: 25 berechnet, aber nur 20 bestellt/);
  assert.match(t, /warnung: „Rasengitter“: Preis 10,50 € statt bestellt 10,00 € \(\+5 %\)/);
  assert.match(t, /warnung: Position 3 „Frachtkosten“/);
  assert.equal(r.ergebnis, "fehler");
});

test("Teilrechnungen: früher Berechnetes zählt mit; Preis in der Toleranz", () => {
  const b = basis();
  b.bestellung!.positionen[0].berechnetVorher = 5;
  b.positionen = [{ nr: 1, artNr: "SPL-032", text: "Splitt", menge: 5, preis: 30.5, gesamt: 152.5 }];
  b.kopf = { ...b.kopf, netto: 152.5, summePositionen: 152.5, mwst: 28.98, brutto: 181.48, zahlbetrag: 181.48 };
  b.steuern = [{ basis: 152.5, betrag: 28.98, kategorie: "S", satz: 19 }];
  const r = pruefen(b);
  assert.equal(r.regeln.filter((x) => x.gruppe === "bestellung" && x.status !== "ok").length, 0, JSON.stringify(r.regeln));
});

test("Rechenfehler, doppelte Rechnung, neue IBAN, fremder Empfänger, fehlende USt-IdNr.", () => {
  const b = basis({ doppelt: { nummer: "RE-55", datum: "05.11.2026" }, bestellung: null });
  b.kopf.mwst = 96; b.kopf.iban = "DE89370400440532013000"; b.kopf.kaeufer.name = "Riedrich und Dremel GmbH"; b.kopf.lieferant.ustId = null;
  const t = pruefen(b).regeln.map((x) => `${x.status}: ${x.text}`).join("\n");
  assert.match(t, /fehler: Netto 500,00 € \+ Steuer 96,00 € ergibt nicht 595,00 €/);
  assert.match(t, /fehler: Summe der Steuerbeträge/);
  assert.match(t, /fehler: Rechnung RE-55 dieses Lieferanten ist schon erfasst/);
  assert.match(t, /fehler: Neue Bankverbindung DE89370400440532013000/);
  assert.match(t, /warnung: Rechnung ist an „Riedrich und Dremel GmbH“ adressiert/);
  assert.match(t, /fehler: USt-IdNr. oder Steuernummer/);
  assert.match(t, /hinweis: Keine Bestellung zugeordnet/);
});

test("§ 13b und Zuordnung über Reihenfolge", () => {
  const r = pruefen(basis({ steuern: [{ basis: 500, betrag: 0, kategorie: "AE", satz: 0 }], kopf: { ...basis().kopf, mwst: 0, brutto: 500, zahlbetrag: 500 } }));
  assert.ok(r.steuerUmkehr);
  const z = zuordnen([{ nr: 1, artNr: null, text: "A", menge: 1, preis: 1, gesamt: 1 }, { nr: 2, artNr: null, text: "B", menge: 1, preis: 1, gesamt: 1 }],
    [{ id: "x", artNr: null, text: "Kies", menge: 1, geliefert: 1, berechnetVorher: 0, preis: 1 }, { id: "y", artNr: null, text: "Sand", menge: 1, geliefert: 1, berechnetVorher: 0, preis: 1 }]);
  assert.deepEqual(Object.fromEntries(z), { 1: "x", 2: "y" });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { neuerDurchschnitt } from "../../src/lib/rechnung/lager";
import { maschinensatz, naechsteFaelligkeit, pruefAmpel } from "../../src/lib/rechnung/geraete";
import { planErgebnis } from "../../src/lib/rechnung/plankosten";

test("Gleitender Durchschnitt", () => {
  assert.equal(neuerDurchschnitt(10, 2, 10, 4), 3);
  assert.equal(neuerDurchschnitt(0, 2, 5, 4), 4);       // leerer Bestand: neuer EK
  assert.equal(neuerDurchschnitt(-3, 2, 5, 4), 4);      // negativer Bestand: neuer EK
  assert.equal(neuerDurchschnitt(30, 1.5, 0, 9), 1.5);  // kein Zugang
});

test("Maschinenstundensatz Minibagger", () => {
  // 48.000 €, 8 Jahre, 600 h/Jahr, 5 % Zins, 8 % Reparatur, 1.200 € fix, 9 €/h Diesel
  const r = maschinensatz({ anschaffungspreis: 48000, nutzungsdauerJahre: 8, einsatzstundenJahr: 600, zinsProzent: 5, reparaturProzent: 8, fixkostenJahr: 1200, betriebskostenStd: 9 });
  assert.equal(r.afa, 6000);
  assert.equal(r.zins, 1200);
  assert.equal(r.reparatur, 3840);
  assert.equal(r.jahreskosten, 12240);
  assert.equal(r.kalkuliert, 29.4);   // 12.240 / 600 + 9
  assert.equal(r.wirksam, 29.4);
  assert.equal(maschinensatz({ anschaffungspreis: 1000, nutzungsdauerJahre: 5, einsatzstundenJahr: 0, zinsProzent: 5, reparaturProzent: 8, fixkostenJahr: 0, betriebskostenStd: 0, verrechnungssatz: 12 }).wirksam, 12);
});

test("Fälligkeit mit Monatsende und Ampel", () => {
  assert.equal(naechsteFaelligkeit(new Date("2026-01-31T00:00:00Z"), 1)!.toISOString().slice(0, 10), "2026-02-28");
  assert.equal(naechsteFaelligkeit(new Date("2025-03-15T00:00:00Z"), 12)!.toISOString().slice(0, 10), "2026-03-15");
  assert.equal(naechsteFaelligkeit(null, 12), null);
  const heute = new Date("2026-11-07T00:00:00Z");
  assert.equal(pruefAmpel(new Date("2026-11-01T00:00:00Z"), heute), "ueberfaellig");
  assert.equal(pruefAmpel(new Date("2026-11-30T00:00:00Z"), heute), "bald");
  assert.equal(pruefAmpel(new Date("2027-06-01T00:00:00Z"), heute), "ok");
  assert.equal(pruefAmpel(null, heute), "offen");
});

test("Plankostenrechnung", () => {
  const r = planErgebnis(
    { mitarbeiter: 6, bezahlteStundenJahr: 1700, produktivProzent: 80, mittellohn: 20, lohnnebenkostenProzent: 90,
      materialEinsatzJahr: 200000, fremdEinsatzJahr: 50000, wagnisGewinnProzent: 10 },
    [{ betragJahr: 163200, verteilung: "LOHN" }, { betragJahr: 20000, verteilung: "MATERIAL" }, { betragJahr: 0, verteilung: "FREMD" }],
  );
  // bezahlt 10.200 h, produktiv 8.160 h, Lohnkosten 10.200 × 20 × 1,9 = 387.600
  assert.equal(r.bezahlteStunden, 10200);
  assert.equal(r.produktiveStunden, 8160);
  assert.equal(r.lohnkosten, 387600);
  assert.equal(r.lohnJeStd, 47.5);        // 387.600 / 8.160
  assert.equal(r.gkJeStd, 20);            // 163.200 / 8.160
  assert.equal(r.stundensatz, 74.25);     // 67,50 × 1,1
  assert.equal(r.materialAufschlag, 21);  // (1,1 × 1,1 − 1) × 100
  assert.equal(r.fremdAufschlag, 10);
  assert.ok(r.planergebnis > 0);
});

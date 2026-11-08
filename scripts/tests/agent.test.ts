import { test } from "node:test";
import assert from "node:assert/strict";
import { freieTermine, istOffen, planLesen, planText, gleicheNummer, nummerSchluessel, wochentag, STANDARD_TERMINZEITEN } from "../../src/lib/agent/zeiten";
import { berlinZuUtc, berlinUhrzeit, berlinTag } from "../../src/lib/zeit";

test("Wochentag und Bürozeiten in Berliner Zeit", () => {
  assert.equal(wochentag("2026-11-09"), 1); // Montag
  assert.equal(wochentag("2026-11-15"), 7);
  const plan = planLesen("Mo-Do 07:00-16:00, Fr 07:00-13:00");
  assert.ok(istOffen(plan, berlinZuUtc("2026-11-09", "07:30")));
  assert.ok(!istOffen(plan, berlinZuUtc("2026-11-13", "13:30")));
  assert.ok(!istOffen(plan, berlinZuUtc("2026-11-14", "10:00")));
  assert.equal(planText(plan), "Mo-Do 07:00-16:00, Fr 07:00-13:00");
  assert.throws(() => planLesen("Montag früh"));
  assert.throws(() => planLesen("Mo 16:00-07:00"));
});

test("Freie Termine: Vorlauf, Raster, belegte Zeiten, je Tag begrenzt", () => {
  const jetzt = berlinZuUtc("2026-11-09", "10:00"); // Montag
  const belegt = [{ beginn: berlinZuUtc("2026-11-11", "09:00"), ende: berlinZuUtc("2026-11-11", "10:00") }];
  const s = freieTermine({ plan: STANDARD_TERMINZEITEN, dauerMin: 60, vorlaufTage: 2, tageVoraus: 21, belegt, jetzt, anzahl: 4, jeTag: 2 });
  assert.equal(s.length, 4);
  assert.equal(berlinTag(s[0].beginn), "2026-11-11");
  assert.equal(berlinUhrzeit(s[0].beginn), "10:00"); // 09:00 ist belegt
  assert.equal(berlinUhrzeit(s[1].beginn), "11:00");
  assert.equal(berlinTag(s[2].beginn), "2026-11-12");
  assert.match(s[0].text, /^Mittwoch, 11\.11\.2026 um 10:00 Uhr$/);
  // Wochenende hat keine Fenster
  const sa = freieTermine({ plan: STANDARD_TERMINZEITEN, dauerMin: 60, vorlaufTage: 0, tageVoraus: 1, belegt: [], jetzt: berlinZuUtc("2026-11-14", "08:00") });
  assert.equal(sa.length, 0);
});

test("Rufnummern vergleichen", () => {
  assert.equal(nummerSchluessel("+49 (0)3327 7407716"), "33277407716");
  assert.equal(nummerSchluessel("0049 3327 7407716"), "33277407716");
  assert.ok(gleicheNummer("+493327 7407716", "03327/7407716"));
  assert.ok(gleicheNummer("0171 1234567", "+49 171 1234567"));
  assert.ok(!gleicheNummer("0171 1234567", "0171 1234568"));
  assert.ok(!gleicheNummer("123", "123"));
});

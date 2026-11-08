import { test } from "node:test";
import assert from "node:assert/strict";
import { berlinZuUtc, berlinTag, berlinUhrzeit, wochenbeginn, kalenderwoche, tagPlus, arbeitszeitPruefen, stundenText } from "../../src/lib/zeit";

test("Berliner Ortszeit nach UTC, Winter und Sommer", () => {
  assert.equal(berlinZuUtc("2026-11-08", "07:30").toISOString(), "2026-11-08T06:30:00.000Z"); // MEZ
  assert.equal(berlinZuUtc("2026-07-01", "07:30").toISOString(), "2026-07-01T05:30:00.000Z"); // MESZ
  // Umstellungstage
  assert.equal(berlinZuUtc("2026-03-29", "12:00").toISOString(), "2026-03-29T10:00:00.000Z");
  assert.equal(berlinZuUtc("2026-10-25", "12:00").toISOString(), "2026-10-25T11:00:00.000Z");
  assert.equal(berlinZuUtc("2026-03-29", "00:00").toISOString(), "2026-03-28T23:00:00.000Z");
});

test("UTC nach Berliner Tag und Uhrzeit", () => {
  const spaet = new Date("2026-11-08T23:30:00Z"); // in Berlin schon der 9.
  assert.equal(berlinTag(spaet), "2026-11-09");
  assert.equal(berlinUhrzeit(spaet), "00:30");
  assert.equal(berlinUhrzeit(new Date("2026-07-01T05:30:00Z")), "07:30");
});

test("Wochen", () => {
  assert.equal(wochenbeginn("2026-11-08"), "2026-11-02"); // Sonntag → Montag davor
  assert.equal(wochenbeginn("2026-11-02"), "2026-11-02");
  assert.equal(tagPlus("2026-12-31", 1), "2027-01-01");
  assert.equal(kalenderwoche("2026-11-08"), 45);
  assert.equal(kalenderwoche("2027-01-01"), 53);
});

test("Arbeitszeitgesetz", () => {
  const e = (von: string, bis: string, kategorie = "UMSETZUNG") => ({ beginn: berlinZuUtc("2026-11-09", von), ende: berlinZuUtc("2026-11-09", bis), kategorie });
  assert.deepEqual(arbeitszeitPruefen([e("07:00", "13:00")]).hinweise, []); // genau 6 h
  assert.equal(arbeitszeitPruefen([e("07:00", "13:30")]).hinweise.length, 1); // 6,5 h ohne Pause
  assert.deepEqual(arbeitszeitPruefen([e("07:00", "12:00"), e("12:00", "12:30", "PAUSE"), e("12:30", "16:00")]).hinweise, []);
  const lang = arbeitszeitPruefen([e("06:00", "12:00"), e("12:00", "12:30", "PAUSE"), e("12:30", "17:00")]); // 10,5 h, 30 min Pause
  assert.equal(lang.arbeit, 630);
  assert.equal(lang.hinweise.length, 2);
  assert.equal(stundenText(125), "2:05");
});

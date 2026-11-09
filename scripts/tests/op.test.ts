import { test } from "node:test";
import assert from "node:assert/strict";
import { offenerBetrag, opStatus, abgleichen, verzugszinsen, datevZeile, datevKopf, alsAnsi, tageUeberfaellig, type Kandidat } from "../../src/lib/faktura/op";

const r = (x: Partial<Parameters<typeof offenerBetrag>[0]> = {}) => ({ status: "FESTGESCHRIEBEN" as const, art: "RECHNUNG", datum: new Date("2026-11-02T12:00:00Z"), zahlungszielTage: 14, zahlbetrag: 1190, skontoProzent: 2, skontoTage: 7, ...x });

test("Offener Betrag und Status", () => {
  const jetzt = new Date("2026-11-10T12:00:00Z");
  assert.equal(offenerBetrag(r(), []), 1190);
  assert.equal(opStatus(r(), [{ betrag: 500 }], jetzt), "teilbezahlt");
  assert.equal(opStatus(r(), [{ betrag: 1166.2 }, { betrag: 23.8 }], jetzt), "ausgeglichen");
  assert.equal(opStatus(r(), [], new Date("2026-11-17T12:00:00Z")), "ueberfaellig");
  assert.equal(opStatus(r(), [], new Date("2026-11-16T12:00:00Z")), "offen");
  assert.equal(tageUeberfaellig(r(), new Date("2026-11-26T12:00:00Z")), 10);
  assert.equal(offenerBetrag(r({ art: "STORNO", zahlbetrag: -1190 }), []), 0);
  assert.equal(offenerBetrag(r({ status: "STORNIERT" }), []), 0);
  assert.equal(offenerBetrag(r({ status: "STORNIERT" }), [{ betrag: 200 }]), -200);
  assert.equal(offenerBetrag(r({ status: "ENTWURF" }), []), 0);
});

test("Bankabgleich: Nummer, Skonto, Betrag, längste Nummer gewinnt", () => {
  const k: Kandidat[] = [
    { id: "a", nummer: "2026-11", offen: 50, kunde: "A", datum: new Date("2026-11-02"), skontoProzent: 0, skontoTage: 0 },
    { id: "b", nummer: "2026-114", offen: 1190, kunde: "Musterfrau", datum: new Date("2026-11-02"), skontoProzent: 2, skontoTage: 7 },
    { id: "c", nummer: "2026-115", offen: 333.33, kunde: "Sommer", datum: new Date("2026-11-02"), skontoProzent: 0, skontoTage: 0 },
  ];
  const tag = new Date("2026-11-06");
  assert.deepEqual(abgleichen({ betrag: 1190, verwendungszweck: "RE 2026 114 Musterfrau", name: null, buchungstag: tag }, k), { rechnungId: "b", betrag: 1190, skonto: 0, sicherheit: "sicher", grund: "Rechnungsnummer 2026-114, Betrag passt" });
  const s = abgleichen({ betrag: 1166.2, verwendungszweck: "Rechnung 2026-114", name: null, buchungstag: tag }, k)!;
  assert.equal(s.skonto, 23.8); assert.equal(s.sicherheit, "sicher");
  assert.equal(abgleichen({ betrag: 1166.2, verwendungszweck: "Rechnung 2026-114", name: null, buchungstag: new Date("2026-11-30") }, k)!.sicherheit, "pruefen");
  assert.equal(abgleichen({ betrag: 333.33, verwendungszweck: "Danke", name: null, buchungstag: tag }, k)!.rechnungId, "c");
  assert.equal(abgleichen({ betrag: 99, verwendungszweck: "Danke", name: null, buchungstag: tag }, k), null);
  assert.equal(abgleichen({ betrag: -50, verwendungszweck: "2026-11", name: null, buchungstag: tag }, k), null);
});

test("Verzugszinsen nach § 288 BGB", () => {
  assert.equal(verzugszinsen(1000, 2, true, 365), 70);
  assert.equal(verzugszinsen(1000, 2, false, 30), 9.04);
  assert.equal(verzugszinsen(1000, 2, false, 0), 0);
});

test("DATEV-Zeilen und Kopf", () => {
  assert.equal(datevZeile({ betrag: 1190, konto: "10001", gegenkonto: "8400", datum: new Date("2026-11-02T12:00:00Z"), beleg: "2026-114", text: "Rechnung Musterfrau" }),
    '1190,00;"S";"EUR";;;;10001;8400;;0211;"2026-114";"";;"Rechnung Musterfrau"');
  assert.match(datevZeile({ betrag: -50, konto: "10001", gegenkonto: "8400", datum: new Date(), beleg: "x", text: "Storno" }), /^50,00;"H"/);
  const kopf = datevKopf({ beraterNr: "1234567", mandantNr: "10001", wjBeginn: "20260101", von: "20261101", bis: "20261130", bezeichnung: "Ausgangsrechnungen", jetzt: new Date("2026-11-09T10:00:00Z") });
  assert.ok(kopf.startsWith('"EXTF";700;21;"Buchungsstapel";13;20261109100000000;;"RE"'));
  assert.ok(kopf.includes(';1234567;10001;20260101;4;20261101;20261130;'));
  assert.deepEqual([...alsAnsi("Größe € „x“")], [0x47, 0x72, 0xf6, 0xdf, 0x65, 0x20, 0x80, 0x20, 0x84, 0x78, 0x93]);
});

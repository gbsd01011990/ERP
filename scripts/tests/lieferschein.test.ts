import { test } from "node:test";
import assert from "node:assert/strict";
import { dateiTyp, nummerAusText } from "../../src/lib/einkauf/lieferschein-hilfen";

test("Dateityp am Inhalt erkennen", () => {
  assert.equal(dateiTyp(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(dateiTyp(Buffer.from("89504e470d0a1a0a0000000d", "hex")), "image/png");
  assert.equal(dateiTyp(Buffer.from("%PDF-1.7\n%âãÏÓ")), "application/pdf");
  assert.equal(dateiTyp(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic0000")])), "image/heic");
  assert.equal(dateiTyp(Buffer.from("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(dateiTyp(Buffer.from("<html><script>alert(1)</script>")), null);
});

test("Lieferscheinnummer aus Betreff oder Dateiname", () => {
  assert.equal(nummerAusText("Lieferschein 4711 vom 05.11."), "4711");
  assert.equal(nummerAusText("LS-2026-0815.pdf"), "2026-0815");
  assert.equal(nummerAusText("Ihr Lieferschein Nr. A-99812"), "A-99812");
  assert.equal(nummerAusText("Rechnung 123"), null);
});

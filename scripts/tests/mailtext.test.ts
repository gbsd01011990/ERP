import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlZuText, adressenLesen, zitat, textZuHtml } from "../../src/lib/mailtext";

test("HTML zu Klartext", () => {
  const html = `<html><head><style>p{color:red}</style></head><body><p>Sehr geehrte Damen und Herren,</p>
  <p>wir m&ouml;chten eine <b>Hecke</b> pflanzen lassen.<br>Ca. 30&nbsp;m.</p><ul><li>Hainbuche</li><li>Liguster</li></ul>
  <a href="https://example.de/plan.pdf">Plan</a> &amp; Fotos<script>alert(1)</script></body></html>`;
  const t = htmlZuText(html);
  assert.ok(t.startsWith("Sehr geehrte Damen und Herren,\n"));
  assert.ok(t.includes("möchten eine Hecke pflanzen lassen.\nCa. 30 m."));
  assert.ok(t.includes("• Hainbuche\n• Liguster"));
  assert.ok(t.includes("Plan (https://example.de/plan.pdf) & Fotos"));
  assert.ok(!t.includes("alert") && !t.includes("color:red"));
});

test("Adressen lesen", () => {
  const r = adressenLesen("Max Muster <Max@Example.de>; info@gbsd-werder.de, kaputt, max@example.de");
  assert.deepEqual(r.gueltig, ["max@example.de", "info@gbsd-werder.de"]);
  assert.deepEqual(r.ungueltig, ["kaputt"]);
});

test("Zitat und HTML", () => {
  assert.ok(zitat("Hallo\nWelt", "Erika", "07.11.2026").endsWith("> Hallo\n> Welt"));
  assert.equal(textZuHtml("a<b\nc"), '<div style="font-family:Arial,sans-serif;font-size:10.5pt">a&lt;b<br>c</div>');
});

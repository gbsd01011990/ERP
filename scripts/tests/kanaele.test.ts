import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { telegramLesen, telegramPruefen, whatsappLesen, whatsappPruefen, twilioPruefen, smsLesen, whatsappFensterOffen } from "../../src/lib/kanaele/adapter";

test("Telegram: Text, Foto, Gruppen werden übergangen, Geheimnis", () => {
  const u = { update_id: 1, message: { message_id: 7, date: 1762600000, text: "Hallo, Hecke schneiden?", chat: { id: 4711, type: "private", first_name: "Erika", last_name: "Muster", username: "erika" }, from: { first_name: "Erika", last_name: "Muster" } } };
  const [e] = telegramLesen(u);
  assert.equal(e.chat, "4711"); assert.equal(e.absender, "@erika"); assert.equal(e.name, "Erika Muster"); assert.equal(e.nachrichtId, "7");
  assert.equal(telegramLesen({ update_id: 2, message: { ...u.message, text: undefined, photo: [{}] } })[0].text, "[Foto]");
  assert.equal(telegramLesen({ update_id: 3, message: { ...u.message, chat: { id: -1, type: "group" } } }).length, 0);
  assert.ok(telegramPruefen("abc", "abc")); assert.ok(!telegramPruefen("abc", "abd")); assert.ok(!telegramPruefen(undefined, "abc"));
});

test("WhatsApp: Nachrichten, Statusmeldungen, fremde Nummer, Signatur", () => {
  const p = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "PN1" }, contacts: [{ wa_id: "491715550100", profile: { name: "Erika" } }],
    messages: [{ id: "wamid.1", from: "491715550100", timestamp: "1762600000", type: "text", text: { body: "Wann kommen Sie?" } }],
  } }, { field: "messages", value: { metadata: { phone_number_id: "PN1" }, statuses: [{ id: "x" }] } }] }] };
  const e = whatsappLesen(p, "PN1");
  assert.equal(e.length, 1); assert.equal(e[0].telefon, "+491715550100"); assert.equal(e[0].name, "Erika"); assert.equal(e[0].text, "Wann kommen Sie?");
  assert.equal(whatsappLesen(p, "ANDERE").length, 0);
  const body = JSON.stringify(p);
  const sig = "sha256=" + createHmac("sha256", "geheim").update(body).digest("hex");
  assert.ok(whatsappPruefen("geheim", sig, body)); assert.ok(!whatsappPruefen("geheim", sig, body + " ")); assert.ok(!whatsappPruefen("geheim", null, body));
  const jetzt = new Date("2026-11-09T12:00:00Z");
  assert.ok(whatsappFensterOffen(new Date("2026-11-08T13:00:00Z"), jetzt)); assert.ok(!whatsappFensterOffen(new Date("2026-11-08T11:00:00Z"), jetzt));
});

test("Twilio: Signatur nach Twilio-Verfahren, SMS lesen", () => {
  // Beispiel aus der Twilio-Dokumentation (Auth-Token 12345)
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const felder = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  assert.ok(twilioPruefen("12345", "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", url, felder));
  assert.ok(!twilioPruefen("12345", "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", url, { ...felder, Digits: "9" }));
  const [s] = smsLesen({ From: "+491715550100", To: "+4915112345678", Body: " Bitte Rückruf ", MessageSid: "SM1" });
  assert.equal(s.text, "Bitte Rückruf"); assert.equal(s.chat, "+491715550100");
  assert.equal(smsLesen({ From: "x" }).length, 0);
});

/**
 * Integrationstest der Microsoft-Anbindung gegen einen nachgebauten Graph-Server.
 * Braucht die Datenbank (DATABASE_URL) und Grunddaten (Seed). Aufruf: npm run test:integration
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const gesendet: { pfad: string; body: Record<string, unknown> }[] = [];
let tokenAnfragen = 0;
const jetzt = Date.now();
const iso = (minutenZurueck: number) => new Date(jetzt - minutenZurueck * 60000).toISOString();

const nachricht = (id: string, von: string, betreff: string, extra: Record<string, unknown> = {}) => ({
  id, internetMessageId: `<${id}@test>`, conversationId: `konv-${id}`, subject: betreff,
  from: { emailAddress: { name: "Absender", address: von } }, toRecipients: [{ emailAddress: { address: "info@gbsd-test.de" } }],
  bodyPreview: "Vorschau", body: { contentType: "html", content: "<p>Guten Tag,<br>bitte um ein Angebot.</p>" },
  hasAttachments: false, webLink: `https://outlook/${id}`, receivedDateTime: iso(60), isRead: false, ...extra,
});

let server: http.Server;
let basis = "";

before(async () => {
  server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (c) => (roh += c));
    req.on("end", () => {
      const url = new URL(req.url!, basis);
      const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      if (url.pathname.endsWith("/oauth2/v2.0/token")) {
        tokenAnfragen++;
        const p = new URLSearchParams(roh);
        if (p.get("client_secret") !== "geheim") return json(401, { error: "invalid_client", error_description: "Falsches Secret" });
        return json(200, { access_token: "tok", expires_in: 3600 });
      }
      if (req.headers.authorization !== "Bearer tok") return json(401, { error: { code: "InvalidAuthenticationToken" } });
      const p = decodeURIComponent(url.pathname);
      if (p === "/v1.0/users/fremd@gbsd-test.de/mailFolders/inbox") return json(403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } });
      if (/\/v1.0\/users\/[^/]+\/mailFolders\/inbox$/.test(p)) return json(200, { id: "inbox" });
      if (p === "/v1.0/users/info@gbsd-test.de/mailFolders/inbox/messages/delta") {
        if (url.searchParams.get("runde") === "2") return json(200, { value: [], "@odata.deltaLink": `${basis}/v1.0/users/info@gbsd-test.de/mailFolders/inbox/messages/delta?runde=2` });
        if (url.searchParams.get("seite") === "2") {
          return json(200, {
            value: [nachricht("m3", "unbekannt@web.de", "Anfrage Hecke"), { id: "m-weg", "@removed": { reason: "deleted" } }],
            "@odata.deltaLink": `${basis}/v1.0/users/info@gbsd-test.de/mailFolders/inbox/messages/delta?runde=2`,
          });
        }
        return json(200, {
          value: [nachricht("m1", "Kunde@Example.de", "Rasen mähen"), nachricht("m2", "kunde@example.de", "Entwurf", { isDraft: true })],
          "@odata.nextLink": `${basis}/v1.0/users/info@gbsd-test.de/mailFolders/inbox/messages/delta?seite=2`,
        });
      }
      if (p === "/v1.0/users/max@gbsd-test.de/mailFolders/inbox/messages/delta") {
        // dieselbe Mail m1 auch im persönlichen Postfach (Kopie) → darf nicht doppelt erscheinen
        return json(200, { value: [nachricht("x1", "kunde@example.de", "Rasen mähen", { internetMessageId: "<m1@test>" })], "@odata.deltaLink": `${basis}/d` });
      }
      if (p.endsWith("/sentitems/messages/delta") || p === "/d") {
        if (p.startsWith("/v1.0/users/info@") && url.searchParams.get("runde") === "s2" && gesendet.length > 0) {
          return json(200, {
            value: [nachricht("s1", "info@gbsd-test.de", "AW: Rasen mähen", { toRecipients: [{ emailAddress: { address: "kunde@example.de" } }], receivedDateTime: new Date().toISOString() })],
            "@odata.deltaLink": `${basis}/v1.0/users/info@gbsd-test.de/mailFolders/sentitems/messages/delta?runde=s2`,
          });
        }
        return json(200, { value: [], "@odata.deltaLink": `${basis}/v1.0/users/info@gbsd-test.de/mailFolders/sentitems/messages/delta?runde=s2` });
      }
      if (req.method === "POST" && (p.endsWith("/sendMail") || p.endsWith("/reply"))) {
        gesendet.push({ pfad: p, body: JSON.parse(roh) });
        res.writeHead(202); return res.end();
      }
      json(404, { error: { code: "NotFound", message: p } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, { MS_LOGIN_URL: basis, MS_GRAPH_URL: `${basis}/v1.0`, ERP_SCHLUESSEL: "test-schluessel-test-schluessel-1234567890" });
});

after(() => server.close());

test("Microsoft-Anbindung: Zugang, Postfächer, Abruf, Zuordnung, Versand", async () => {
  const { db } = await import("../../src/lib/db");
  const mail = await import("../../src/lib/dienste/mail");
  const firma = await db.firma.findUniqueOrThrow({ where: { kuerzel: "GBSD" } });
  const admin = await db.benutzer.findFirstOrThrow({ where: { rolle: "ADMIN", zugriffe: { some: { firmaId: firma.id } } }, include: { zugriffe: { include: { firma: true } } } });
  const b = { ...admin, zugriffe: admin.zugriffe.filter((z) => z.firmaId === firma.id), mandant: firma };
  const vorher = { msTenantId: firma.msTenantId, msClientId: firma.msClientId, msClientSecret: firma.msClientSecret };

  // Testdaten
  const kontakt = await db.kontakt.create({ data: { nachname: "Mailtest", email: "kunde@example.de" } });
  const status = await db.pipelineStatus.findFirstOrThrow({ where: { firmaId: firma.id, abgeschlossen: false } });
  const projekt = await db.projekt.create({ data: { firmaId: firma.id, nummer: `MT-${jetzt}`, titel: "Mailtest", kontaktId: kontakt.id, statusId: status.id } });
  try {
    // Zugang: falsches Secret wird abgelehnt, richtiges gespeichert (verschlüsselt)
    await assert.rejects(mail.msZugangSpeichern(b, { tenantId: "t1", clientId: "c1", clientSecret: "falsch" }), /Falsches Secret/);
    await mail.msZugangSpeichern(b, { tenantId: "t1", clientId: "c1", clientSecret: "geheim" });
    // Nach erfolgreicher Anmeldung darf ein falsches Secret nicht über den Token-Zwischenspeicher durchrutschen
    await assert.rejects(mail.msZugangSpeichern(b, { tenantId: "t1", clientId: "c1", clientSecret: "falsch" }), /Falsches Secret/);
    const f2 = await db.firma.findUniqueOrThrow({ where: { id: firma.id } });
    assert.ok(f2.msClientSecret?.startsWith("v1.") && !f2.msClientSecret.includes("geheim"), "Secret verschlüsselt gespeichert");

    // Postfach ohne Zugriff → verständliche Meldung
    await assert.rejects(mail.postfachSpeichern(b, null, { art: "GETEILT", adresse: "fremd@gbsd-test.de", zugriffe: [] }), /keinen Zugriff auf dieses Postfach/);
    const info = await mail.postfachSpeichern(b, null, { art: "GETEILT", adresse: "Info@GBSD-test.de", name: "Info", zugriffe: [admin.id] });
    const max = await mail.postfachSpeichern(b, null, { art: "PERSOENLICH", adresse: "max@gbsd-test.de", benutzerId: admin.id });
    assert.equal(info.adresse, "info@gbsd-test.de");

    // Abruf mit Seiten, Entwurf und gelöschter Nachricht
    const r1 = await mail.postfachAbrufen(info.id);
    assert.equal(r1.neu, 2);
    const m1 = await db.email.findFirstOrThrow({ where: { postfachId: info.id, graphId: "m1" } });
    assert.equal(m1.kontaktId, kontakt.id, "über Absender zugeordnet (Groß-/Kleinschreibung egal)");
    assert.equal(m1.projektId, projekt.id, "einziges offenes Projekt zugeordnet");
    assert.equal(m1.text, "Guten Tag,\nbitte um ein Angebot.");
    const m3 = await db.email.findFirstOrThrow({ where: { postfachId: info.id, graphId: "m3" } });
    assert.equal(m3.kontaktId, null, "unbekannter Absender bleibt offen");
    assert.equal(await db.email.count({ where: { postfachId: info.id, graphId: "m2" } }), 0, "Entwurf übersprungen");

    // Zweiter Abruf nutzt den Delta-Link: nichts Neues
    assert.equal((await mail.postfachAbrufen(info.id)).neu, 0);
    // Gleiche Mail im persönlichen Postfach wird nicht doppelt angelegt
    assert.equal((await mail.postfachAbrufen(max.id)).neu, 0);

    // Sichtbarkeit: Mitarbeiter ohne Freigabe sieht nicht zugeordnete Mail aus info@ nicht
    const kolonne = { ...b, id: "fremd", rolle: "KOLONNE" as const };
    await assert.rejects(mail.emailLaden(kolonne, m3.id), /nicht gefunden/);
    assert.ok(await mail.emailLaden(b, m3.id));

    // Antwort aus der App: Reply-Endpunkt mit Anhang, Platzhalter, Logbuch
    const antwort = await mail.senden(b, {
      postfachId: info.id, an: "kunde@example.de", betreff: "x", text: "Gern, anbei das Angebot.", antwortAufId: m1.id,
      anhaenge: [{ name: "Angebot.pdf", typ: "application/pdf", daten: Buffer.from("%PDF-1.4") }],
    });
    assert.ok(gesendet[0].pfad.endsWith("/messages/m1/reply"));
    const msg = gesendet[0].body.message as { attachments: { name: string }[] };
    assert.equal(msg.attachments[0].name, "Angebot.pdf");
    assert.equal(antwort.betreff, "AW: Rasen mähen");
    assert.equal(antwort.projektId, projekt.id);
    assert.ok(await db.logbuchEintrag.findFirst({ where: { projektId: projekt.id, art: "EMAIL" } }));
    // Senden aus fremdem Postfach verboten, ungültige Adresse abgelehnt
    await assert.rejects(mail.senden(kolonne, { postfachId: info.id, an: "a@b.de", betreff: "x", text: "y" }), /nicht senden/);
    await assert.rejects(mail.senden(b, { postfachId: info.id, an: "kaputt", betreff: "x", text: "y" }), /Ungültige Adresse/);

    // Nächster Abruf bringt die gesendete Mail und ersetzt den Platzhalter
    await mail.postfachAbrufen(info.id);
    const ersetzt = await db.email.findUniqueOrThrow({ where: { id: antwort.id } });
    assert.equal(ersetzt.graphId, "s1");

    // Von Hand zuordnen
    await mail.emailZuordnen(b, m3.id, null, projekt.id);
    assert.equal((await db.email.findUniqueOrThrow({ where: { id: m3.id } })).kontaktId, kontakt.id);
    assert.ok(tokenAnfragen <= 4, `Token wird zwischengespeichert (${tokenAnfragen} Anfragen)`);
  } finally {
    await db.postfach.deleteMany({ where: { firmaId: firma.id, adresse: { endsWith: "@gbsd-test.de" } } });
    await db.projekt.delete({ where: { id: projekt.id } });
    await db.kontakt.delete({ where: { id: kontakt.id } });
    await db.firma.update({ where: { id: firma.id }, data: vorher });
    await db.$disconnect();
  }
});

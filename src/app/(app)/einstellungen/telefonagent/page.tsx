import { headers } from "next/headers";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { planText, type Wochenplan } from "@/lib/agent/zeiten";
import { agentFuerFirma, systemAnweisung, werkzeugDefinitionen, W, type Weiterleitung } from "@/lib/dienste/telefonagent";
import { AktionsFormular } from "@/components/aktions-formular";
import { AusgabeFormular } from "@/components/ausgabe-formular";
import { agentAktion, schluesselAktion, webhookAktion, testWerkzeugAktion, testAnrufAktion } from "./actions";

const BEISPIELE: Record<string, object> = {
  kunde_suchen: { anrufer: "+49 3327 123456", gespraech_id: "test-1" },
  anfrage_anlegen: { anrufer: "+49 171 5550100", gespraech_id: "test-1", anrede: "Frau", nachname: "Beispiel", strasse: "Lindenweg 4", plz: "14542", ort: "Werder (Havel)", titel: "Heckenschnitt 30 m", anliegen: "Liguster, ca. 30 m lang, 1,8 m hoch, Schnitt im Frühjahr" },
  freie_termine: { gespraech_id: "test-1" },
  termin_buchen: { anrufer: "+49 171 5550100", gespraech_id: "test-1", beginn: "<beginn aus freie_termine>", name: "Frau Beispiel", ort: "Lindenweg 4, Werder", anliegen: "Besichtigung Hecke" },
  angebot_status: { anrufer: "+49 3327 123456", gespraech_id: "test-1" },
  rueckruf_anlegen: { anrufer: "+49 171 5550100", gespraech_id: "test-1", name: "Herr Muster", anliegen: "Frage zur Rechnung", fuer: "" },
  buerozeiten: {},
};

export default async function TelefonagentSeite() {
  const b = await benutzerPflicht(["ADMIN"]);
  const a = await agentFuerFirma(b.mandant.id);
  const mitarbeiter = await db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: b.mandant.id } }, rolle: { not: "KOLONNE" } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const h = await headers();
  const basis = process.env.ERP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const kuerzel = a.firma.kuerzel.toLowerCase();
  const wl = (a.weiterleitungen as Weiterleitung[]) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Telefonagent · {a.firma.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Der Agent nimmt Anrufe an, wenn im Büro niemand rangeht (Rufumleitung bei Nichtmelden, Besetzt und außerhalb der Bürozeiten).
          Er erkennt Kunden an der Rufnummer, nimmt Anfragen auf, bucht Besichtigungen, nennt den Stand von Angeboten, legt Rückrufe an und verbindet in Notfällen weiter.
          Jedes Gespräch landet unter <a href="/anrufe" className="text-marke">Anrufe</a>. Diese Einstellungen gelten nur für {a.firma.name}.
        </p>
      </div>

      <section className="karte">
        <h2 className="mb-3 font-semibold">Verhalten</h2>
        <AktionsFormular aktion={agentAktion} knopf="Einstellungen speichern" className="grid gap-4 md:grid-cols-4">
          <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" name="aktiv" defaultChecked={a.aktiv} /> Agent ist eingeschaltet (Werkzeuge antworten der Sprachplattform)</label>
          <div><label className="label">Name des Agenten</label><input name="name" defaultValue={a.name} className="eingabe" /></div>
          <div>
            <label className="label">Zuständig für Anfragen und Rückrufe</label>
            <select name="standardZustaendigId" defaultValue={a.standardZustaendigId ?? ""} className="eingabe">
              <option value="">– bitte wählen –</option>
              {mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2"><label className="label">Agent-ID bei der Sprachplattform</label><input name="agentId" defaultValue={a.agentId ?? ""} className="eingabe font-mono" /></div>
          <div className="md:col-span-4"><label className="label">Begrüßung (erster Satz, mit KI- und Aufzeichnungshinweis)</label><textarea name="begruessung" rows={2} defaultValue={a.begruessung} className="eingabe" /></div>
          <div className="md:col-span-2"><label className="label">Bürozeiten</label><input name="buerozeiten" defaultValue={planText(a.buerozeiten as Wochenplan)} placeholder="Mo-Do 07:00-16:00, Fr 07:00-13:00" className="eingabe" /></div>
          <div className="md:col-span-2"><label className="label">Zeitfenster für Besichtigungen</label><input name="terminZeiten" defaultValue={planText(a.terminZeiten as Wochenplan)} placeholder="Mo-Fr 09:00-15:00" className="eingabe" /></div>
          <div><label className="label">Termindauer Minuten</label><input name="terminDauerMin" defaultValue={a.terminDauerMin} className="eingabe" /></div>
          <div><label className="label">Frühestens in Tagen</label><input name="terminVorlaufTage" defaultValue={a.terminVorlaufTage} className="eingabe" /></div>
          <div><label className="label">Höchstens Tage voraus</label><input name="terminTageVoraus" defaultValue={a.terminTageVoraus} className="eingabe" /></div>
          <div />
          <div className="md:col-span-4">
            <label className="label">Weiterverbinden (je Zeile: Name; Nummer; wofür)</label>
            <textarea name="weiterleitungen" rows={3} defaultValue={wl.map((w) => `${w.name}; ${w.nummer}; ${w.wofuer}`).join("\n")} placeholder="Büro; +49 3327 7407716; Rechnungen und allgemeine Fragen" className="eingabe font-mono text-xs" />
          </div>
          <div><label className="label">Notfallnummer</label><input name="notfallNummer" defaultValue={a.notfallNummer ?? ""} placeholder="+49 171 …" className="eingabe" /></div>
          <div className="md:col-span-3"><label className="label">Wann ist es ein Notfall?</label><input name="notfallRegel" defaultValue={a.notfallRegel ?? ""} className="eingabe" /></div>
          <div className="md:col-span-2"><label className="label">Leistungen (was wir machen, was nicht, Einzugsgebiet)</label><textarea name="leistungen" rows={4} defaultValue={a.leistungen ?? ""} className="eingabe" /></div>
          <div className="md:col-span-2"><label className="label">Weitere Regeln</label><textarea name="anweisungen" rows={4} defaultValue={a.anweisungen ?? ""} placeholder="z. B. Keine Preise am Telefon nennen. Baumfällungen nur nach Besichtigung." className="eingabe" /></div>
        </AktionsFormular>
      </section>

      <section className="karte space-y-3 text-sm">
        <h2 className="font-semibold">Anbindung der Sprachplattform</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>Bei ElevenLabs einen Agenten anlegen: Sprache Deutsch, Modell Claude, erste Nachricht = Begrüßung, Systemanweisung unten einfügen.</li>
          <li>Werkzeug-Schlüssel erzeugen und bei jedem Werkzeug als Kopfzeile <code>Authorization: Bearer …</code> eintragen. Die Werkzeuge stehen unten als JSON.</li>
          <li>Systemwerkzeuge „transfer_to_number“ (mit den Nummern oben) und „end_call“ einschalten.</li>
          <li>Webhook nach dem Gespräch („post_call_transcription“) auf <code className="break-all">{basis}/api/agent/{kuerzel}/anruf-ende</code> setzen und das HMAC-Geheimnis hier speichern.</li>
          <li>Twilio-Nummer der Firma in ElevenLabs verbinden und bei der Telekom die Umleitung bei Nichtmelden, Besetzt und nachts auf diese Nummer stellen.</li>
        </ol>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="label">Werkzeug-Schlüssel {a.schluesselVorschau ? `(aktiv, endet auf …${a.schluesselVorschau})` : "(noch keiner)"}</div>
            <AusgabeFormular aktion={schluesselAktion} knopf={a.schluesselVorschau ? "Neuen Schlüssel erzeugen (alter wird ungültig)" : "Schlüssel erzeugen"} />
          </div>
          <div className="space-y-2">
            <div className="label">Webhook-Geheimnis {a.webhookGeheimnis ? "(hinterlegt)" : "(fehlt)"}</div>
            <AktionsFormular aktion={webhookAktion} knopf="Geheimnis speichern" knopfKlasse="btn-hell" zuruecksetzen className="flex flex-wrap gap-2">
              <input name="geheimnis" type="password" autoComplete="off" placeholder="wsec_…" className="eingabe flex-1" />
            </AktionsFormular>
          </div>
        </div>
        <details>
          <summary className="cursor-pointer text-marke">Systemanweisung</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{systemAnweisung(a)}</pre>
        </details>
        <details>
          <summary className="cursor-pointer text-marke">Werkzeuge (JSON)</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(werkzeugDefinitionen(basis, kuerzel), null, 2)}</pre>
        </details>
      </section>

      <section className="karte space-y-4 text-sm">
        <h2 className="font-semibold">Testkonsole</h2>
        <p className="text-slate-600">Ruft die Werkzeuge so auf wie die Sprachplattform, auch wenn der Agent ausgeschaltet ist. Die Ergebnisse sind echt: angelegte Anfragen, Termine und Rückrufe erscheinen im ERP.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <AusgabeFormular aktion={testWerkzeugAktion} knopf="Werkzeug aufrufen" className="space-y-2">
            <label className="label" htmlFor="werkzeug">Werkzeug</label>
            <select id="werkzeug" name="werkzeug" className="eingabe">{Object.keys(W).map((w) => <option key={w}>{w}</option>)}</select>
            <label className="label" htmlFor="eingabe">Eingabe (JSON)</label>
            <textarea id="eingabe" name="eingabe" rows={8} className="eingabe font-mono text-xs" defaultValue={JSON.stringify(BEISPIELE.kunde_suchen, null, 2)} />
            <details className="text-xs text-slate-500"><summary className="cursor-pointer">Beispiele</summary><pre className="whitespace-pre-wrap">{Object.entries(BEISPIELE).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n\n")}</pre></details>
          </AusgabeFormular>
          <AusgabeFormular aktion={testAnrufAktion} knopf="Gespräch einspielen" className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="anrufer">Rufnummer</label><input id="anrufer" name="anrufer" placeholder="+49 171 5550100" className="eingabe" /></div>
              <div><label className="label" htmlFor="gespraechId">Gesprächs-ID (optional)</label><input id="gespraechId" name="gespraechId" placeholder="test-1" className="eingabe" /></div>
            </div>
            <label className="label" htmlFor="verlauf">Verlauf (K: Kunde, A: Agent)</label>
            <textarea id="verlauf" name="verlauf" rows={5} className="eingabe font-mono text-xs" defaultValue={"A: Guten Tag, hier ist die digitale Assistenz.\nK: Ich hätte gern ein Angebot für einen Heckenschnitt.\nA: Gern, ich nehme das auf."} />
            <label className="label" htmlFor="zusammenfassung">Zusammenfassung</label>
            <input id="zusammenfassung" name="zusammenfassung" defaultValue="Kundin wünscht Angebot für Heckenschnitt, ca. 30 m." className="eingabe" />
          </AusgabeFormular>
        </div>
      </section>
    </div>
  );
}

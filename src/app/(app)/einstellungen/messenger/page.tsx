import { headers } from "next/headers";
import { benutzerPflicht } from "@/lib/auth";
import { zugaengeDerFirma, geheimLesen, MESSENGER, KANAL_TEXT } from "@/lib/dienste/kanaele";
import { AktionsFormular } from "@/components/aktions-formular";
import { zugangAktion, telegramAktion } from "./actions";

const HILFE = {
  TELEGRAM: {
    kennung: "Bot-Name (z. B. gbsd_bot)",
    felder: [["token", "Bot-Token von @BotFather"]],
    schritte: ["In Telegram @BotFather öffnen, /newbot, Namen vergeben.", "Token hier eintragen, speichern, einschalten.", "„Mit Telegram verbinden“ klicken. Kunden schreiben dem Bot über t.me/<Bot-Name>."],
  },
  WHATSAPP: {
    kennung: "Phone-Number-ID (Meta)",
    felder: [["zugriffstoken", "Dauerhaftes Zugriffstoken (System-User)"], ["appGeheimnis", "App-Geheimnis (App Secret)"], ["verifyToken", "Verify-Token (frei wählbar)"]],
    schritte: ["Im Meta-Business-Konto eine App mit WhatsApp anlegen und die Firmennummer registrieren.", "Phone-Number-ID, Zugriffstoken und App-Geheimnis hier eintragen, Verify-Token frei wählen.", "Bei Meta unter Webhooks die Adresse unten und den Verify-Token eintragen, das Feld „messages“ abonnieren."],
  },
  SMS: {
    kennung: "Absendernummer (+49…, SMS-fähig)",
    felder: [["accountSid", "Twilio Account SID"], ["authToken", "Twilio Auth Token"]],
    schritte: ["Deutsche Ortsnummern können meist keine SMS. Dafür bei Twilio eine Mobilnummer (+491…) kaufen.", "Account SID und Auth Token hier eintragen.", "In Twilio bei der Nummer unter „A message comes in“ die Adresse unten (HTTP POST) eintragen."],
  },
} as const;

export default async function Messenger() {
  const b = await benutzerPflicht(["ADMIN"]);
  const zugaenge = await zugaengeDerFirma(b.mandant.id);
  const h = await headers();
  const basis = process.env.ERP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const kuerzel = b.mandant.kuerzel.toLowerCase();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Messenger · {b.mandant.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Nachrichten landen unter <a href="/anrufe" className="text-marke">Kommunikation</a>, werden über die Rufnummer dem Kunden zugeordnet und lassen sich direkt beantworten.
          Außerhalb der Bürozeiten (aus den Telefonagent-Einstellungen) antwortet das ERP einmal mit dem Abwesenheitstext. Gespeicherte Schlüssel werden nie wieder angezeigt; leere Felder lassen sie unverändert.
        </p>
      </div>
      {MESSENGER.map((k, i) => {
        const z = zugaenge[i];
        const g = z ? (geheimLesen(z) as Record<string, Record<string, string> | undefined>) : {};
        const gespeichert = g[k === "TELEGRAM" ? "telegram" : k === "WHATSAPP" ? "whatsapp" : "sms"] ?? {};
        const hilfe = HILFE[k];
        return (
          <section key={k} className="karte space-y-3 text-sm">
            <h2 className="font-semibold">{KANAL_TEXT[k]} {z?.aktiv ? <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">eingeschaltet</span> : <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">aus</span>}</h2>
            <ol className="list-decimal space-y-1 pl-5 text-slate-600">{hilfe.schritte.map((s) => <li key={s}>{s}</li>)}</ol>
            <div className="text-xs text-slate-500">Webhook-Adresse: <code className="break-all">{basis}/api/kanal/{kuerzel}/{k.toLowerCase()}</code></div>
            <AktionsFormular aktion={zugangAktion} knopf="Speichern" className="grid gap-3 md:grid-cols-3">
              <input type="hidden" name="kanal" value={k} />
              <label className="flex items-center gap-2 md:col-span-3"><input type="checkbox" name="aktiv" defaultChecked={z?.aktiv ?? false} /> eingeschaltet</label>
              <div><label className="label">{hilfe.kennung}</label><input name="kennung" defaultValue={z?.kennung ?? ""} className="eingabe" /></div>
              {hilfe.felder.map(([name, label]) => (
                <div key={name}>
                  <label className="label">{label}{gespeichert[name] ? " (gespeichert)" : ""}</label>
                  <input name={name} type="password" autoComplete="off" placeholder={gespeichert[name] ? "••••••••" : ""} className="eingabe" />
                </div>
              ))}
              <div className="md:col-span-3"><label className="label">Abwesenheitstext (leer = Standard)</label><input name="abwesenheit" defaultValue={z?.abwesenheit ?? ""} className="eingabe" /></div>
            </AktionsFormular>
            {k === "TELEGRAM" && z && <AktionsFormular aktion={telegramAktion} knopf="Mit Telegram verbinden" knopfKlasse="btn-hell" />}
          </section>
        );
      })}
      <section className="karte text-sm text-slate-600">
        <h2 className="mb-1 font-semibold text-slate-900">Weitere Messenger</h2>
        <p>Threema Work folgt (braucht ein Threema-Gateway-Konto mit Ende-zu-Ende-Modus). Signal bietet keine offizielle Schnittstelle für Firmen; iMessage nur über „Apple Messages for Business“ mit einem von Apple zugelassenen Anbieter.</p>
      </section>
    </div>
  );
}

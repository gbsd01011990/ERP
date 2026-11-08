"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { text, zahl } from "@/lib/formular";
import { planLesen } from "@/lib/agent/zeiten";
import {
  agentFuerFirma, agentSpeichern, werkzeugSchluesselErzeugen, webhookGeheimnisSpeichern,
  werkzeugAusfuehren, anrufBeendet, W, type WerkzeugName,
} from "@/lib/dienste/telefonagent";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;
const PFAD = "/einstellungen/telefonagent";

async function melden(fn: () => Promise<string | void>): Promise<Ergebnis> {
  try {
    const ok = await fn();
    revalidatePath(PFAD);
    return { ok: ok || "Gespeichert.", zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof ZodError) return { fehler: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" "), zeit: Date.now() };
    if (e instanceof SyntaxError) return { fehler: `JSON ungültig: ${e.message}`, zeit: Date.now() };
    if (e instanceof Error && /nicht verstanden|Ende vor Beginn|Wochentag/.test(e.message)) return { fehler: e.message, zeit: Date.now() };
    throw e;
  }
}

/** Weiterleitungen als Zeilen „Name; Nummer; wofür“. */
function weiterleitungenLesen(s: string | null) {
  return (s ?? "").split("\n").map((z) => z.trim()).filter(Boolean).map((z) => {
    const [name, nummer, ...rest] = z.split(";").map((t) => t.trim());
    if (!name || !nummer || !rest.join(";")) throw new FachFehler(`Weiterleitung nicht verstanden: „${z}“ (Format: Name; Nummer; wofür)`);
    return { name, nummer, wofuer: rest.join("; ") };
  });
}

export async function agentAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(() => agentSpeichern(b, {
    aktiv: f.get("aktiv") === "on",
    name: String(f.get("name") ?? ""),
    begruessung: String(f.get("begruessung") ?? ""),
    anweisungen: text(f, "anweisungen"),
    leistungen: text(f, "leistungen"),
    buerozeiten: planLesen(String(f.get("buerozeiten") ?? "")),
    terminZeiten: planLesen(String(f.get("terminZeiten") ?? "")),
    terminDauerMin: Math.round(zahl(f, "terminDauerMin", 60)),
    terminVorlaufTage: Math.round(zahl(f, "terminVorlaufTage", 2)),
    terminTageVoraus: Math.round(zahl(f, "terminTageVoraus", 21)),
    weiterleitungen: weiterleitungenLesen(text(f, "weiterleitungen")),
    notfallNummer: text(f, "notfallNummer"),
    notfallRegel: text(f, "notfallRegel"),
    standardZustaendigId: text(f, "standardZustaendigId"),
    agentId: text(f, "agentId"),
  }));
}

export async function schluesselAktion(_: unknown, _f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(async () => `Neuer Werkzeug-Schlüssel (nur jetzt sichtbar, bei der Sprachplattform als Bearer-Token eintragen): ${await werkzeugSchluesselErzeugen(b)}`);
}

export async function webhookAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(() => webhookGeheimnisSpeichern(b, String(f.get("geheimnis") ?? "")));
}

/** Testkonsole: Werkzeug mit JSON-Eingabe aufrufen, so wie es die Sprachplattform tut. */
export async function testWerkzeugAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(async () => {
    const name = String(f.get("werkzeug")) as WerkzeugName;
    if (!(name in W)) throw new FachFehler("Unbekanntes Werkzeug.");
    const a = await agentFuerFirma(b.mandant.id);
    const eingabe = JSON.parse(String(f.get("eingabe") || "{}"));
    return JSON.stringify(await werkzeugAusfuehren(a, name, eingabe), null, 2);
  });
}

/** Testkonsole: ein beendetes Gespräch einspielen (Zeilen „K: …“ für Kunde, „A: …“ für Agent). */
export async function testAnrufAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN"]);
  return melden(async () => {
    const a = await agentFuerFirma(b.mandant.id);
    const zeilen = String(f.get("verlauf") ?? "").split("\n").map((z) => z.trim()).filter(Boolean);
    const g = await anrufBeendet(a, {
      type: "post_call_transcription",
      data: {
        conversation_id: text(f, "gespraechId") ?? `test-${Date.now()}`,
        transcript: zeilen.map((z, i) => ({ role: /^k:/i.test(z) ? "user" : "agent", message: z.replace(/^[ka]:\s*/i, ""), time_in_call_secs: i * 8 })),
        metadata: { call_duration_secs: zeilen.length * 8, phone_call: { external_number: text(f, "anrufer") } },
        analysis: { transcript_summary: text(f, "zusammenfassung") },
      },
    });
    return `Gespräch übernommen: /anrufe/${g.id}`;
  });
}

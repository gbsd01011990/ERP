import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";

/** Brücke zum Python-Dienst gaeb/gaeb_dienst.py (pyGAEB). */
const SKRIPT = path.join(process.cwd(), "gaeb", "gaeb_dienst.py");

export type GaebAdresse = { name?: string | null; name2?: string | null; street?: string | null; pcode?: string | null; city?: string | null; email?: string | null; phone?: string | null };
export type GaebPosition = {
  art: "GRUPPE" | "POSITION" | "TEXT";
  ebene: number;
  oz: string;
  gaebId: string;
  kurztext: string;
  langtext?: string;
  menge?: number | null;
  mengeOffen?: boolean;
  einheit?: string;
  ep?: number | null;
  gp?: number | null;
  typ?: string;
  bedarf?: boolean;
  bedarfMitGp?: boolean;
  preisanteile?: number[];
};
export type GaebLesen = {
  phase: string | null;
  version: string | null;
  art: "procurement" | "quantity" | "trade" | "cost" | string | null;
  warnungen: string[];
  projekt?: { name?: string | null; nummer?: string | null; beschreibung?: string | null; vergabeNr?: string | null; boqId?: string | null };
  auftraggeber?: GaebAdresse | null;
  preisanteilNamen?: string[];
  positionen?: GaebPosition[];
  summe?: number | null;
  mengen?: { oz: string; menge: number | null; zeilen: string[] }[];
  handel?: { artNr?: string | null; lieferantArtNr?: string | null; ean?: string | null; kurztext?: string | null; menge?: number | null; einheit?: string | null; angebotspreis?: number | null; nettopreis?: number | null; preisbasis?: number | null }[];
};

export type GaebPartei = { name: string; strasse?: string | null; plz?: string | null; ort?: string | null; email?: string | null; telefon?: string | null; ustId?: string | null };
export type GaebSchreiben = {
  phase: string;
  quelle?: { name: string; daten: string } | null;
  preise?: { schluessel: string; ep: number | null; anteile?: number[] }[];
  positionen?: { art: string; ebene?: number; kurztext: string; langtext?: string | null; menge?: number; einheit?: string; ep?: number; bedarf?: boolean }[];
  kopf?: { projektName?: string; projektNr?: string; bieter?: GaebPartei; auftraggeber?: GaebPartei };
};

export class GaebFehler extends Error {}

async function aufrufen<T>(befehl: "lesen" | "schreiben", eingabe: unknown): Promise<T> {
  const ausgabe = await new Promise<string>((resolve, reject) => {
    const p = spawn(process.env.PYTHON ?? "python3", [SKRIPT, befehl], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", () => (out ? resolve(out) : reject(new GaebFehler(`GAEB-Dienst ohne Antwort: ${err.slice(-500)}`))));
    p.stdin.end(JSON.stringify(eingabe));
  });
  const j = JSON.parse(ausgabe) as T & { fehler?: string };
  if (j.fehler) throw new GaebFehler(`GAEB-Datei nicht verarbeitbar: ${j.fehler}`);
  return j;
}

export const gaebLesen = (name: string, daten: Buffer) => aufrufen<GaebLesen>("lesen", { name, daten: daten.toString("base64") });

export async function gaebSchreiben(eingabe: GaebSchreiben) {
  const r = await aufrufen<{ daten: string; warnungen: string[] }>("schreiben", eingabe);
  return { daten: Buffer.from(r.daten, "base64"), warnungen: r.warnungen };
}

/** Ordnungszahlen vergleichbar machen: „01.02.0010“ ≙ „1.2.10“. */
export const ozSchluessel = (oz: string | null | undefined) =>
  (oz ?? "").split(/[.\s]+/).filter(Boolean).map((t) => t.replace(/^0+(?=\w)/, "")).join(".");

import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { berechnung, empfaengerAus, type GeladeneRechnung, type Beleg } from "../dienste/rechnungen";
import { pdfErzeugen } from "../pdf";
import { n } from "../kalkulation";
import { rechnungDaten } from "./pdf";
import { ciiErzeugen, xrechnungMaengel, type CiiProfil } from "./cii";
import { VERKAEUFER } from "./stammdaten";
import { ART_TITEL } from "./texte";

const SKRIPT = path.join(process.cwd(), "pdf", "erechnung.py");

function factur(befehl: "einbetten" | "pruefen", eingabe: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.PYTHON ?? "python3", [SKRIPT, befehl], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = []; let err = "";
    p.stdout.on("data", (c) => out.push(c)); p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split("\n").slice(-3).join(" ").slice(0, 600) || `Exit ${code}`))));
    p.stdin.end(JSON.stringify(eingabe));
  });
}

/** CII-XML einer Rechnung im gewünschten Profil. */
export function ciiFuer(r: GeladeneRechnung, profil: CiiProfil) {
  const v = VERKAEUFER[r.firma.kuerzel];
  if (!v) throw new Error(`Keine Verkäuferdaten für ${r.firma.kuerzel}`);
  const e = empfaengerAus(r);
  const k = r.projekt.kontakt;
  const adr = k.adressen.find((x) => x.art === "RECHNUNG") ?? k.adressen.find((x) => x.art === "HAUPT") ?? k.adressen[0];
  const kaeufer = {
    name: e.name ?? e.zeilen[0] ?? "", strasse: e.strasse ?? adr?.strasse ?? null, plz: e.plz ?? adr?.plz ?? null, ort: e.ort ?? adr?.ort ?? null,
    land: e.land ?? "DE", email: e.email ?? k.email ?? null, ustId: e.ustId ?? k.ustId ?? null, kundennummer: e.kundennummer || null, kontaktperson: e.kontaktperson ?? null,
  };
  const d = rechnungDaten(r);
  const rechnung = {
    nummer: r.nummer ?? "ENTWURF", art: r.art, datum: r.datum, leistungVon: r.leistungVon, leistungBis: r.leistungBis,
    kundenReferenz: r.kundenReferenz, steuerschuldUmkehr: r.steuerschuldUmkehr, zahlungszielTage: r.zahlungszielTage,
    skontoProzent: n(r.skontoProzent), skontoTage: r.skontoTage, einbehaltProzent: n(r.einbehaltProzent),
    bezug: r.bezug?.nummer ? { nummer: r.bezug.nummer, datum: r.bezug.datum } : null,
    hinweise: [`${d.dokumentart} ${r.betreff}`, ...(d.rechnung?.hinweise ?? []).map((h) => `${h.titel}: ${h.text}`)],
  };
  return {
    xml: ciiErzeugen({ profil, verkaeufer: v, kaeufer, rechnung, positionen: d.positionen.map((p) => ({ ...p, langtext: p.langtext || null })), berechnung: berechnung(r) }),
    maengel: profil === "XRECHNUNG" ? xrechnungMaengel(v, kaeufer, rechnung) : [],
  };
}

/**
 * Beleg zum Festschreiben: Rechnungs-PDF mit eingebetteter E-Rechnung (ZUGFeRD EN 16931) und,
 * wenn alle Pflichtangaben da sind, die XRechnung. Scheitert die E-Rechnung, bleibt das normale PDF
 * und der Grund steht im Hinweis – das Festschreiben selbst scheitert daran nicht.
 */
export async function belegBauen(r: GeladeneRechnung): Promise<Beleg> {
  const pdf = await pdfErzeugen(rechnungDaten(r) as never);
  const hinweise: string[] = [];
  let xml: string | null = null, mitXml = pdf;
  try {
    xml = ciiFuer(r, "EN16931").xml;
    mitXml = await factur("einbetten", { pdf: pdf.toString("base64"), xml, titel: `${ART_TITEL[r.art]} ${r.nummer}`, autor: r.firma.name });
  } catch (e) {
    hinweise.push(`ZUGFeRD nicht eingebettet: ${(e as Error).message}`);
    xml = null;
  }
  let xrechnung: string | null = null;
  try {
    const x = ciiFuer(r, "XRECHNUNG");
    if (x.maengel.length) hinweise.push(`Keine XRechnung, es fehlt: ${x.maengel.join(", ")}.`);
    else {
      const p = JSON.parse((await factur("pruefen", { xml: x.xml })).toString("utf8")) as { ok?: boolean; fehler?: string };
      if (p.ok) xrechnung = x.xml; else hinweise.push(`XRechnung ungültig: ${p.fehler}`);
    }
  } catch (e) {
    hinweise.push(`XRechnung nicht erzeugt: ${(e as Error).message}`);
  }
  return { pdf: mitXml, xml, xrechnung, hinweis: hinweise.join(" ") || null };
}

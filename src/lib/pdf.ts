import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { datum } from "./format";
import { n, nummerieren, wirksamerEp, runden } from "./kalkulation";
import { angebotSummen, type GeladenesAngebot } from "./angebot";
import { empfaengerZeilen } from "./vorlagen";

const SKRIPT = path.join(process.cwd(), "pdf", "erzeugen.py");

/** Baut die JSON-Daten für pdf/erzeugen.py. */
export function belegDaten(a: GeladenesAngebot, ansprechpartner?: string) {
  const k = a.projekt.kontakt;
  const adresse = k.adressen.find((x) => x.art === "RECHNUNG") ?? k.adressen.find((x) => x.art === "HAUPT") ?? k.adressen[0];
  const s = angebotSummen(a);
  const saetze = { stundensatz: a.stundensatz, materialAufschlag: a.materialAufschlag, fremdAufschlag: a.fremdAufschlag };
  return {
    firma: a.firma.kuerzel,
    dokumentart: a.art === "ANGEBOT" ? "Angebot" : "Auftragsbestätigung",
    belegnummer: a.version > 1 ? `${a.nummer}-${a.version}` : a.nummer,
    datum: datum(a.datum),
    gueltigBis: a.art === "ANGEBOT" && a.gueltigBis ? datum(a.gueltigBis) : "",
    empfaenger: empfaengerZeilen(a.firma.kuerzel, k, adresse ?? undefined),
    kundennummer: k.nummer ?? "",
    ansprechpartner: ansprechpartner ?? a.erstelltVon?.name ?? "",
    betreff: a.betreff,
    anrede: a.anrede ?? "",
    einleitung: a.einleitung ?? "",
    vorbemerkung: a.vorbemerkung ?? "",
    schlusstext: a.schlusstext ?? "",
    verbraucher: k.kategorie === "PRIVAT",
    positionen: nummerieren(a.positionen).map((p) => {
      const ep = wirksamerEp(p, saetze);
      return {
        art: p.art, posNr: p.posNr, kurztext: p.kurztext, langtext: p.langtext ?? "",
        menge: n(p.menge), einheit: p.einheit, einzelpreis: ep, gesamt: runden(ep * n(p.menge)), bedarf: p.bedarf,
      };
    }),
    summen: { netto: s.netto, mwst: s.mwst, brutto: s.brutto, mwstSatz: n(a.mwstSatz), lohnanteilBrutto: s.lohnanteilBrutto },
  };
}

/** Ruft den Python-Generator auf und liefert die PDF-Bytes. */
export async function pdfErzeugen(daten: ReturnType<typeof belegDaten>): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "erp-pdf-"));
  const ziel = path.join(dir, "beleg.pdf");
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(process.env.PYTHON ?? "python3", [SKRIPT, ziel], { stdio: ["pipe", "ignore", "pipe"] });
      let fehler = "";
      p.stderr.on("data", (c) => (fehler += c));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`PDF-Erzeugung fehlgeschlagen (${code}): ${fehler.slice(-2000)}`))));
      p.stdin.end(JSON.stringify(daten));
    });
    return await readFile(ziel);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteNummer } from "../nummern";
import { VORLAGEN, briefanrede } from "../vorlagen";
import { datum } from "../format";
import { einzelpreisAnteile, n, wirksamerEp, aufmassSumme } from "../kalkulation";
import { nettoAktualisieren } from "../angebot";
import { gaebLesen, gaebSchreiben, ozSchluessel, type GaebPartei } from "../gaeb";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

const MAX_DATEI = 20 * 1024 * 1024;
export const EXPORT_PHASEN = {
  X84: "Angebotsabgabe",
  X85: "Nebenangebot",
  X86: "Auftragserteilung",
  X80: "Universelle LV-Daten",
  X81: "Leistungsbeschreibung (ohne Preise)",
  X82: "Kostenanschlag (mit Preisen)",
  X83: "Angebotsaufforderung (ohne Preise, z. B. an Nachunternehmer)",
} as const;
export type ExportPhase = keyof typeof EXPORT_PHASEN;

/** LV-Phasen, aus denen ein Angebot entsteht; X86 (Auftrag) wird zur Auftragsbestätigung. */
const LV_PHASEN = new Set(["X80", "X81", "X82", "X83", "X84", "X85", "X86", "X88", "X89", "X89B", "X52"]);

function dateiPruefen(daten: Buffer) {
  if (!daten.length) throw new FachFehler("Die Datei ist leer.");
  if (daten.length > MAX_DATEI) throw new FachFehler("Die Datei ist größer als 20 MB.");
}

// ------------------------------------------------------------ LV importieren

/**
 * Legt aus einer GAEB-Datei (X80–X86, auch DA XML 2.x und GAEB 90) ein Angebot im Projekt an.
 * Titelstruktur, Ordnungszahlen, Texte, Mengen, Bedarfspositionen und – falls vorhanden – Preise
 * werden übernommen. Die Originaldatei bleibt gespeichert, damit die Angebotsabgabe (X84) exakt passt.
 */
export async function lvImportieren(b: AktuellerBenutzer, projektId: string, name: string, daten: Buffer) {
  rollePruefen(b);
  dateiPruefen(daten);
  const projekt = await db.projekt.findUnique({ where: { id: projektId }, include: { firma: true, kontakt: true } });
  if (!projekt) throw new FachFehler("Projekt nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, projekt.firmaId);

  const lv = await gaebLesen(name, daten);
  if (lv.art === "quantity") throw new FachFehler("Das ist eine Mengenermittlung (X31). Bitte im Angebot oder in der Auftragsbestätigung unter „Mengen importieren“ einlesen.");
  if (lv.art === "trade") throw new FachFehler("Das ist ein Handelsdokument (X93–X97). Preisangebote (X94) bitte im Lager importieren.");
  if (!lv.phase || !LV_PHASEN.has(lv.phase) || !lv.positionen?.length) throw new FachFehler(`Kein Leistungsverzeichnis gefunden (Phase ${lv.phase ?? "unbekannt"}).`);

  const f = projekt.firma;
  const auftrag = lv.phase === "X86";
  const mitPreisen = lv.positionen.some((p) => p.ep != null);
  const hinweise: string[] = [];
  let reihenfolge = 0;
  const positionen = lv.positionen.map((p) => {
    reihenfolge += 10;
    const langtext = [
      p.langtext || null,
      p.mengeOffen ? "(Menge vom Auftraggeber noch festzulegen)" : null,
      p.typ && ["Markup", "Index", "BaseSurcharge", "Supplement"].includes(p.typ) ? `[GAEB-Positionsart ${p.typ} – bitte Preis prüfen]` : null,
      p.typ === "Alternative" ? "[Wahlposition]" : null,
    ].filter(Boolean).join("\n") || null;
    if (p.typ && ["Markup", "Index", "BaseSurcharge", "Supplement"].includes(p.typ)) hinweise.push(`${p.oz}: ${p.typ}`);
    return {
      reihenfolge,
      art: p.art,
      ebene: Math.max(1, p.ebene),
      oz: p.oz || null,
      gaebId: p.gaebId || null,
      gaebTyp: p.typ ?? null,
      kurztext: (p.kurztext || "(ohne Kurztext)").slice(0, 500),
      langtext,
      menge: p.art === "POSITION" ? (p.menge ?? 0) : 1,
      einheit: p.einheit || "Stk.",
      einzelpreis: p.ep ?? 0,
      preisFest: p.ep != null,
      bedarf: !!p.bedarf,
    };
  });

  const gueltigBis = new Date(Date.now() + f.angebotGueltigTage * 864e5);
  const v = VORLAGEN[f.kuerzel] ?? VORLAGEN.GBSD;
  const titel = lv.projekt?.name || projekt.titel;
  const angebot = await db.$transaction(async (tx) => {
    const nummer = await naechsteNummer(tx, f.id, auftrag ? "AUFTRAG" : "ANGEBOT");
    const a = await tx.angebot.create({
      data: {
        firmaId: f.id, projektId: projekt.id, nummer, art: auftrag ? "AUFTRAGSBESTAETIGUNG" : "ANGEBOT",
        betreff: lv.projekt?.vergabeNr ? `${titel} – Vergabe-Nr. ${lv.projekt.vergabeNr}` : titel,
        anrede: briefanrede(projekt.kontakt), einleitung: auftrag ? null : v.einleitung(datum(gueltigBis)),
        vorbemerkung: v.vorbemerkung ?? null, schlusstext: v.schlusstext ?? null, gueltigBis: auftrag ? null : gueltigBis,
        mwstSatz: f.mwstSatz, stundensatz: f.stundensatz, materialAufschlag: f.materialAufschlag, fremdAufschlag: f.fremdAufschlag,
        erstelltVonId: b.id,
        gaebQuelle: new Uint8Array(daten), gaebName: name.slice(0, 200), gaebPhase: lv.phase,
        gaebInfo: { version: lv.version, projekt: lv.projekt ?? null, auftraggeber: lv.auftraggeber ?? null, preisanteile: lv.preisanteilNamen ?? [], summe: lv.summe ?? null } as Prisma.InputJsonValue,
        positionen: { create: positionen },
      },
    });
    await tx.logbuchEintrag.create({
      data: { projektId: projekt.id, benutzerId: b.id, art: "SYSTEM", text: `GAEB ${lv.phase} „${name}“ importiert: ${positionen.filter((p) => p.art === "POSITION").length} Positionen → ${auftrag ? "Auftragsbestätigung" : "Angebot"} ${nummer}` },
    });
    return a;
  });
  await nettoAktualisieren(angebot.id);
  return { angebot, phase: lv.phase, mitPreisen, hinweise, warnungen: lv.warnungen };
}

// ------------------------------------------------------------ Export

function parteiFirma(f: { name: string; strasse: string | null; plz: string | null; ort: string | null; email: string | null; telefon: string | null }): GaebPartei {
  return { name: f.name, strasse: f.strasse, plz: f.plz, ort: f.ort, email: f.email, telefon: f.telefon };
}

/**
 * Preisanteile je Einheit (Lohn, Stoffe, Geräte, Sonstiges) für GAEB-UPComp.
 * Bei Festpreisen werden die Kalkulationsanteile auf den Festpreis hochgerechnet.
 */
function preisanteile(p: Parameters<typeof einzelpreisAnteile>[0] & { preisFest: boolean; einzelpreis: Prisma.Decimal }, s: Parameters<typeof einzelpreisAnteile>[1], ep: number) {
  const a = einzelpreisAnteile(p, s);
  const teile = [a.lohn, a.material, a.geraete, a.fremd];
  const summe = teile.reduce((x, y) => x + y, 0);
  if (summe <= 0) return undefined;
  const faktor = ep / summe;
  const gerundet = teile.map((t) => Math.round(t * faktor * 100) / 100);
  gerundet[0] = Math.round((ep - gerundet.slice(1).reduce((x, y) => x + y, 0)) * 100) / 100; // Rundungsrest in den Lohn
  return gerundet;
}

export async function lvExportieren(b: AktuellerBenutzer, angebotId: string, phase: ExportPhase) {
  if (!(phase in EXPORT_PHASEN)) throw new FachFehler("Unbekannte GAEB-Phase.");
  const a = await db.angebot.findUnique({
    where: { id: angebotId },
    omit: { gaebQuelle: false },
    include: { firma: true, positionen: { orderBy: { reihenfolge: "asc" } }, projekt: { include: { kontakt: { include: { adressen: true } } } } },
  });
  if (!a) throw new FachFehler("Angebot nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, a.firmaId);
  const saetze = { stundensatz: a.stundensatz, materialAufschlag: a.materialAufschlag, fremdAufschlag: a.fremdAufschlag };
  const k = a.projekt.kontakt;
  const adr = k.adressen.find((x) => x.art === "RECHNUNG") ?? k.adressen.find((x) => x.art === "HAUPT") ?? k.adressen[0];
  const kopf = {
    projektName: a.betreff, projektNr: a.projekt.nummer, bieter: parteiFirma(a.firma),
    auftraggeber: { name: k.firmenname || [k.vorname, k.nachname].filter(Boolean).join(" ") || "Auftraggeber", strasse: adr?.strasse, plz: adr?.plz, ort: adr?.ort, email: k.email },
  };

  const eingabe = a.gaebQuelle
    ? {
        phase, kopf,
        quelle: { name: a.gaebName ?? "quelle.X83", daten: Buffer.from(a.gaebQuelle).toString("base64") },
        preise: a.positionen.filter((p) => p.art === "POSITION").map((p) => {
          const ep = wirksamerEp(p, saetze);
          return { schluessel: p.gaebId ?? p.oz ?? p.id, ep, anteile: preisanteile(p, saetze, ep) };
        }),
      }
    : {
        phase, kopf,
        positionen: a.positionen.map((p) => ({
          art: p.art, ebene: p.ebene, kurztext: p.kurztext, langtext: p.langtext, menge: n(p.menge), einheit: p.einheit,
          ep: p.art === "POSITION" ? wirksamerEp(p, saetze) : undefined, bedarf: p.bedarf,
        })),
      };
  const { daten, warnungen } = await gaebSchreiben(eingabe);
  const nr = a.version > 1 ? `${a.nummer}-${a.version}` : a.nummer;
  await db.logbuchEintrag.create({ data: { projektId: a.projektId, benutzerId: b.id, art: "SYSTEM", text: `GAEB ${phase} (${EXPORT_PHASEN[phase]}) zu ${nr} erzeugt` } });
  return { daten, name: `${nr}.${phase}`, warnungen };
}

// ------------------------------------------------------------ Mengenermittlung X31

/** Übernimmt Mengen aus einer X31 in das Aufmaß des Entwurfs (Zuordnung über die Ordnungszahl). */
export async function mengenImportieren(b: AktuellerBenutzer, angebotId: string, name: string, daten: Buffer) {
  rollePruefen(b);
  dateiPruefen(daten);
  const a = await db.angebot.findUnique({ where: { id: angebotId }, include: { positionen: true } });
  if (!a) throw new FachFehler("Angebot nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, a.firmaId);
  if (a.status !== "ENTWURF") throw new FachFehler("Mengen lassen sich nur in einen Entwurf übernehmen. Lege eine neue Version an.");
  const lv = await gaebLesen(name, daten);
  if (lv.art !== "quantity" || !lv.mengen) throw new FachFehler(`Keine Mengenermittlung (X31) gefunden, sondern ${lv.phase ?? "unbekannt"}.`);

  const nachOz = new Map(a.positionen.filter((p) => p.art === "POSITION").map((p, i) => [ozSchluessel(p.oz) || `#${i}`, p]));
  let uebernommen = 0;
  const unbekannt: string[] = [];
  await db.$transaction(async (tx) => {
    for (const m of lv.mengen!) {
      const pos = nachOz.get(ozSchluessel(m.oz));
      if (!pos || m.menge == null) { unbekannt.push(m.oz); continue; }
      await tx.aufmassZeile.deleteMany({ where: { positionId: pos.id, reb: { not: null } } });
      await tx.aufmassZeile.create({
        data: { positionId: pos.id, reihenfolge: 1000, text: `GAEB X31 „${name}“ (${m.zeilen.length} REB-Zeilen)`, anzahl: m.menge, reb: m.zeilen.join("\n") || null },
      });
      const zeilen = await tx.aufmassZeile.findMany({ where: { positionId: pos.id } });
      await tx.angebotsPosition.update({ where: { id: pos.id }, data: { menge: aufmassSumme(zeilen) } });
      uebernommen++;
    }
    await tx.logbuchEintrag.create({ data: { projektId: a.projektId, benutzerId: b.id, art: "SYSTEM", text: `Mengenermittlung X31 „${name}“: ${uebernommen} Positionen übernommen${unbekannt.length ? `, ${unbekannt.length} ohne passende OZ` : ""}` } });
  });
  await nettoAktualisieren(a.id);
  return { uebernommen, unbekannt };
}

// ------------------------------------------------------------ Preisangebot X94 (Handel)

/**
 * Liest ein Preisangebot (X94, auch X93/X96/X97) und ordnet es Lagerartikeln zu:
 * Artikelnummer des Lieferanten oder eigene Artikelnummer. Optional den EK übernehmen.
 */
export async function preisangebotImportieren(b: AktuellerBenutzer, name: string, daten: Buffer, uebernehmen: boolean) {
  rollePruefen(b);
  dateiPruefen(daten);
  const lv = await gaebLesen(name, daten);
  if (lv.art !== "trade" || !lv.handel) throw new FachFehler(`Kein Handelsdokument (X93–X97) gefunden, sondern ${lv.phase ?? "unbekannt"}.`);
  const artikel = await db.artikel.findMany({ where: { firmaId: b.mandant.id } });
  const ergebnis = lv.handel.map((h) => {
    const preis = h.nettopreis ?? h.angebotspreis ?? null;
    const proEinheit = preis != null && h.preisbasis && h.preisbasis > 0 ? preis / h.preisbasis : preis;
    const treffer = artikel.find((a) => [h.lieferantArtNr, h.artNr, h.ean].filter(Boolean).some((nr) => a.nummer === nr));
    return { ...h, proEinheit, artikelId: treffer?.id ?? null, artikel: treffer ? `${treffer.nummer} ${treffer.bezeichnung}` : null };
  });
  if (uebernehmen) {
    for (const e of ergebnis) {
      if (e.artikelId && e.proEinheit != null) await db.artikel.update({ where: { id: e.artikelId }, data: { letzterEk: e.proEinheit } });
    }
  }
  return { phase: lv.phase, positionen: ergebnis };
}

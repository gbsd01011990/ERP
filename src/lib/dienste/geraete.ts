import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { maschinensatz, naechsteFaelligkeit } from "../rechnung/geraete";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());
const betrag = z.number().nonnegative();

export const GeraetEingabe = z.object({
  firmaId: z.string().min(1),
  inventarNr: z.string().trim().min(1, "Inventarnummer ist Pflicht."),
  bezeichnung: z.string().trim().min(1, "Bezeichnung ist Pflicht."),
  kategorie: z.enum(["FAHRZEUG", "MASCHINE", "ANHAENGER", "KLEINGERAET", "WERKZEUG"]).default("MASCHINE"),
  status: z.enum(["VERFUEGBAR", "IM_EINSATZ", "WERKSTATT", "DEFEKT", "AUSGEMUSTERT"]).default("VERFUEGBAR"),
  hersteller: z.string().nullish(),
  modell: z.string().nullish(),
  seriennummer: z.string().nullish(),
  kennzeichen: z.string().nullish(),
  baujahr: z.number().int().min(1950).max(2100).nullish(),
  lagerId: z.string().nullish(),
  betriebsstunden: betrag.nullish(),
  kmStand: z.number().int().nonnegative().nullish(),
  notiz: z.string().nullish(),
  anschaffungAm: z.date().nullish(),
  anschaffungspreis: betrag.nullish(),
  nutzungsdauerJahre: z.number().int().positive().nullish(),
  einsatzstundenJahr: z.number().int().nonnegative().nullish(),
  zinsProzent: betrag.default(5),
  reparaturProzent: betrag.default(8),
  fixkostenJahr: betrag.default(0),
  betriebskostenStd: betrag.default(0),
  verrechnungssatz: betrag.nullish(),
});
export type GeraetEingabe = z.input<typeof GeraetEingabe>;

export async function geraetSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: GeraetEingabe) {
  rollePruefen(b);
  const e = GeraetEingabe.parse(eingabe);
  firmaPruefen(b, e.firmaId);
  if (e.lagerId) {
    const l = await db.lager.findUnique({ where: { id: e.lagerId } });
    if (!l || l.firmaId !== e.firmaId) throw new FachFehler("Standort gehört nicht zur Firma.");
  }
  const daten = {
    ...e,
    hersteller: leer(e.hersteller), modell: leer(e.modell), seriennummer: leer(e.seriennummer), kennzeichen: leer(e.kennzeichen),
    notiz: leer(e.notiz), lagerId: leer(e.lagerId),
  };
  try {
    if (!id) return await db.geraet.create({ data: daten });
    const alt = await db.geraet.findUnique({ where: { id } });
    if (!alt) throw new FachFehler("Gerät nicht gefunden.", "NICHT_GEFUNDEN");
    firmaPruefen(b, alt.firmaId);
    if (alt.firmaId !== e.firmaId) throw new FachFehler("Ein Gerät kann nicht die Firma wechseln.");
    return await db.geraet.update({ where: { id }, data: daten });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new FachFehler(`Die Inventarnummer ${e.inventarNr} ist in dieser Firma schon vergeben.`);
    throw err;
  }
}

async function geraetLaden(b: AktuellerBenutzer, id: string) {
  const g = await db.geraet.findUnique({ where: { id } });
  if (!g) throw new FachFehler("Gerät nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, g.firmaId);
  return g;
}

export const PruefungEingabe = z.object({
  art: z.enum(["UVV", "HU", "AU", "WARTUNG", "INSPEKTION", "ELEKTROPRUEFUNG", "SONSTIGE"]),
  bezeichnung: z.string().nullish(),
  intervallMonate: z.number().int().positive().nullish(),
  letzteAm: z.date().nullish(),
  /** Ohne Intervall: Fälligkeit direkt angeben */
  naechsteAm: z.date().nullish(),
});

export async function pruefungSpeichern(b: AktuellerBenutzer, geraetId: string, id: string | null, eingabe: z.input<typeof PruefungEingabe>) {
  rollePruefen(b);
  const g = await geraetLaden(b, geraetId);
  const e = PruefungEingabe.parse(eingabe);
  const naechsteAm = naechsteFaelligkeit(e.letzteAm ?? null, e.intervallMonate ?? null) ?? e.naechsteAm ?? null;
  const daten = { art: e.art, bezeichnung: leer(e.bezeichnung), intervallMonate: e.intervallMonate ?? null, letzteAm: e.letzteAm ?? null, naechsteAm };
  if (!id) return db.geraetPruefung.create({ data: { geraetId: g.id, ...daten } });
  const p = await db.geraetPruefung.findUnique({ where: { id } });
  if (!p || p.geraetId !== g.id) throw new FachFehler("Prüfung nicht gefunden.", "NICHT_GEFUNDEN");
  return db.geraetPruefung.update({ where: { id }, data: daten });
}

const PRUEF_TEXT = { UVV: "UVV-Prüfung", HU: "Hauptuntersuchung", AU: "Abgasuntersuchung", WARTUNG: "Wartung", INSPEKTION: "Inspektion", ELEKTROPRUEFUNG: "Elektroprüfung (DGUV V3)", SONSTIGE: "Prüfung" } as const;

/** Prüfung erledigt: letzte = Datum, nächste = Datum + Intervall, Eintrag in der Gerätehistorie. */
export async function pruefungErledigt(b: AktuellerBenutzer, pruefungId: string, am: Date, bemerkung?: string | null, kosten?: number | null) {
  const p = await db.geraetPruefung.findUnique({ where: { id: pruefungId } });
  if (!p) throw new FachFehler("Prüfung nicht gefunden.", "NICHT_GEFUNDEN");
  const g = await geraetLaden(b, p.geraetId);
  rollePruefen(b, ["ADMIN", "BUERO", "KOLONNE"]);
  return db.$transaction([
    db.geraetPruefung.update({ where: { id: p.id }, data: { letzteAm: am, naechsteAm: naechsteFaelligkeit(am, p.intervallMonate) } }),
    db.geraetEreignis.create({
      data: {
        geraetId: g.id, art: p.art === "WARTUNG" || p.art === "INSPEKTION" ? "WARTUNG" : "PRUEFUNG", datum: am, benutzerId: b.id,
        text: `${p.bezeichnung ?? PRUEF_TEXT[p.art]} durchgeführt${bemerkung ? `: ${bemerkung}` : ""}`,
        kosten: kosten ?? null, betriebsstunden: g.betriebsstunden,
      },
    }),
  ]);
}

export const EreignisEingabe = z.object({
  art: z.enum(["PRUEFUNG", "WARTUNG", "REPARATUR", "SCHADEN", "NOTIZ"]),
  datum: z.date(),
  text: z.string().trim().min(1, "Beschreibung ist Pflicht."),
  kosten: betrag.nullish(),
  betriebsstunden: betrag.nullish(),
  /** Neuer Gerätestatus, z. B. WERKSTATT bei einem Schaden */
  status: z.enum(["VERFUEGBAR", "IM_EINSATZ", "WERKSTATT", "DEFEKT", "AUSGEMUSTERT"]).nullish(),
});

export async function ereignisErfassen(b: AktuellerBenutzer, geraetId: string, eingabe: z.input<typeof EreignisEingabe>) {
  rollePruefen(b, ["ADMIN", "BUERO", "KOLONNE"]);
  const g = await geraetLaden(b, geraetId);
  const e = EreignisEingabe.parse(eingabe);
  return db.$transaction(async (tx) => {
    const ev = await tx.geraetEreignis.create({
      data: { geraetId: g.id, art: e.art, datum: e.datum, text: e.text, kosten: e.kosten ?? null, betriebsstunden: e.betriebsstunden ?? g.betriebsstunden, benutzerId: b.id },
    });
    const update = {
      ...(e.status ? { status: e.status } : {}),
      ...(e.betriebsstunden != null && e.betriebsstunden > Number(g.betriebsstunden ?? 0) ? { betriebsstunden: e.betriebsstunden } : {}),
    };
    if (Object.keys(update).length) await tx.geraet.update({ where: { id: g.id }, data: update });
    return ev;
  });
}

export const EinsatzEingabe = z.object({
  projektId: z.string().min(1),
  datum: z.date(),
  stunden: z.number().positive("Stunden müssen größer als 0 sein.").max(24, "Mehr als 24 Stunden an einem Tag sind nicht möglich."),
  notiz: z.string().nullish(),
});

/** Geräteeinsatz auf ein Projekt; der Stundensatz wird eingefroren (Ist-Kosten der Nachkalkulation). */
export async function einsatzErfassen(b: AktuellerBenutzer, geraetId: string, eingabe: z.input<typeof EinsatzEingabe>) {
  rollePruefen(b, ["ADMIN", "BUERO", "KOLONNE"]);
  const g = await geraetLaden(b, geraetId);
  const e = EinsatzEingabe.parse(eingabe);
  if (g.status === "AUSGEMUSTERT") throw new FachFehler("Das Gerät ist ausgemustert.");
  const p = await db.projekt.findUnique({ where: { id: e.projektId } });
  if (!p || p.firmaId !== g.firmaId) throw new FachFehler("Projekt fehlt oder gehört zu einer anderen Firma.");
  const satz = maschinensatz(g).wirksam;
  return db.geraetEinsatz.create({
    data: { geraetId: g.id, projektId: p.id, datum: e.datum, stunden: e.stunden, kostensatz: satz, notiz: leer(e.notiz), benutzerId: b.id },
  });
}

export async function einsatzLoeschen(b: AktuellerBenutzer, einsatzId: string) {
  rollePruefen(b);
  const e = await db.geraetEinsatz.findUnique({ where: { id: einsatzId }, include: { geraet: true } });
  if (!e) throw new FachFehler("Einsatz nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, e.geraet.firmaId);
  await db.geraetEinsatz.delete({ where: { id: e.id } });
  return e;
}

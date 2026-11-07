import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { n } from "../kalkulation";
import { neuerDurchschnitt, buchungswert } from "../rechnung/lager";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());

// ------------------------------------------------------------ Stammdaten

export const LagerEingabe = z.object({
  firmaId: z.string().min(1),
  name: z.string().trim().min(1, "Name ist Pflicht."),
  art: z.enum(["HAUPTLAGER", "AUSSENLAGER", "FAHRZEUG", "BAUSTELLE"]).default("HAUPTLAGER"),
  adresse: z.string().nullish(),
  aktiv: z.boolean().default(true),
});

export async function lagerSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: z.input<typeof LagerEingabe>) {
  rollePruefen(b);
  const e = LagerEingabe.parse(eingabe);
  firmaPruefen(b, e.firmaId);
  const daten = { ...e, adresse: leer(e.adresse) };
  try {
    if (!id) return await db.lager.create({ data: daten });
    const alt = await db.lager.findUnique({ where: { id } });
    if (!alt) throw new FachFehler("Lager nicht gefunden.", "NICHT_GEFUNDEN");
    firmaPruefen(b, alt.firmaId);
    if (alt.firmaId !== e.firmaId) throw new FachFehler("Ein Lager kann nicht die Firma wechseln.");
    return await db.lager.update({ where: { id }, data: daten });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new FachFehler(`Ein Lager „${e.name}“ gibt es in dieser Firma schon.`);
    throw err;
  }
}

export const ArtikelEingabe = z.object({
  firmaId: z.string().min(1),
  nummer: z.string().trim().min(1, "Nummer ist Pflicht."),
  bezeichnung: z.string().trim().min(1, "Bezeichnung ist Pflicht."),
  kategorie: z.string().nullish(),
  einheit: z.string().nullish(),
  mindestbestand: z.number().nonnegative().nullish(),
  lieferant: z.string().nullish(),
  aktiv: z.boolean().default(true),
});

export async function artikelSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: z.input<typeof ArtikelEingabe>) {
  rollePruefen(b);
  const e = ArtikelEingabe.parse(eingabe);
  firmaPruefen(b, e.firmaId);
  const daten = { ...e, kategorie: leer(e.kategorie), einheit: leer(e.einheit) ?? "Stk.", lieferant: leer(e.lieferant), mindestbestand: e.mindestbestand ?? null };
  try {
    if (!id) return await db.artikel.create({ data: daten });
    const alt = await db.artikel.findUnique({ where: { id } });
    if (!alt) throw new FachFehler("Artikel nicht gefunden.", "NICHT_GEFUNDEN");
    firmaPruefen(b, alt.firmaId);
    if (alt.firmaId !== e.firmaId) throw new FachFehler("Ein Artikel kann nicht die Firma wechseln.");
    return await db.artikel.update({ where: { id }, data: daten });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new FachFehler(`Die Artikelnummer ${e.nummer} ist in dieser Firma schon vergeben.`);
    throw err;
  }
}

// ------------------------------------------------------------ Buchungen

export const BuchungEingabe = z.object({
  art: z.enum(["ZUGANG", "ABGANG", "UMBUCHUNG", "PROJEKT", "INVENTUR"]),
  artikelId: z.string().min(1),
  /** Menge; bei INVENTUR der gezählte Bestand */
  menge: z.number().nonnegative(),
  vonLagerId: z.string().nullish(),
  nachLagerId: z.string().nullish(),
  ekPreis: z.number().nonnegative().nullish(),
  projektId: z.string().nullish(),
  beleg: z.string().nullish(),
  notiz: z.string().nullish(),
});
export type BuchungEingabe = z.input<typeof BuchungEingabe>;

/**
 * Bucht eine Lagerbewegung. Regeln:
 * - Lager, Artikel und Projekt gehören zur selben Firma.
 * - Abgang, Projektentnahme und Umbuchung dürfen den Bestand nicht unter 0 drücken.
 * - Zugang aktualisiert den gleitenden Durchschnittspreis über alle Lager.
 * - Inventur setzt den Bestand eines Lagers auf die gezählte Menge und bucht die Differenz.
 */
export async function buchen(b: AktuellerBenutzer, eingabe: BuchungEingabe) {
  rollePruefen(b, ["ADMIN", "BUERO", "KOLONNE"]);
  const e = BuchungEingabe.parse(eingabe);
  if (e.art !== "INVENTUR" && e.menge <= 0) throw new FachFehler("Die Menge muss größer als 0 sein.");
  if (b.rolle === "KOLONNE" && (e.art === "ZUGANG" || e.art === "INVENTUR")) {
    throw new FachFehler("Zugänge und Inventur bucht das Büro.", "KEIN_ZUGRIFF");
  }

  return db.$transaction(
    async (tx) => {
      const artikel = await tx.artikel.findUnique({ where: { id: e.artikelId } });
      if (!artikel) throw new FachFehler("Artikel nicht gefunden.", "NICHT_GEFUNDEN");
      firmaPruefen(b, artikel.firmaId);

      const lagerLaden = async (id: string | null | undefined, rolle: string) => {
        if (!id) throw new FachFehler(`${rolle} fehlt.`);
        const l = await tx.lager.findUnique({ where: { id } });
        if (!l || l.firmaId !== artikel.firmaId) throw new FachFehler(`${rolle} gehört nicht zur Firma des Artikels.`);
        return l;
      };
      const bestand = async (lagerId: string) =>
        n((await tx.bestand.findUnique({ where: { artikelId_lagerId: { artikelId: artikel.id, lagerId } } }))?.menge);
      const aendern = (lagerId: string, delta: number) =>
        tx.bestand.upsert({
          where: { artikelId_lagerId: { artikelId: artikel.id, lagerId } },
          create: { artikelId: artikel.id, lagerId, menge: delta },
          update: { menge: { increment: delta } },
        });
      const genug = async (lagerId: string, name: string) => {
        const vorhanden = await bestand(lagerId);
        if (vorhanden < e.menge) throw new FachFehler(`Im Lager „${name}“ sind nur ${vorhanden.toLocaleString("de-DE")} ${artikel.einheit} vorhanden.`);
      };
      const basis = { artikelId: artikel.id, art: e.art, beleg: leer(e.beleg), notiz: leer(e.notiz), benutzerId: b.id };

      switch (e.art) {
        case "ZUGANG": {
          const nach = await lagerLaden(e.nachLagerId, "Ziellager");
          if (e.ekPreis == null) throw new FachFehler("Für einen Zugang ist der Einkaufspreis Pflicht.");
          const gesamt = await tx.bestand.aggregate({ where: { artikelId: artikel.id }, _sum: { menge: true } });
          const dek = neuerDurchschnitt(gesamt._sum.menge, artikel.durchschnittEk, e.menge, e.ekPreis);
          await aendern(nach.id, e.menge);
          await tx.artikel.update({ where: { id: artikel.id }, data: { durchschnittEk: dek, letzterEk: e.ekPreis } });
          return tx.lagerBuchung.create({ data: { ...basis, menge: e.menge, nachLagerId: nach.id, ekPreis: e.ekPreis, wert: buchungswert(e.menge, e.ekPreis) } });
        }
        case "ABGANG":
        case "PROJEKT": {
          const von = await lagerLaden(e.vonLagerId, "Quelllager");
          let projektId: string | null = null;
          if (e.art === "PROJEKT") {
            const p = e.projektId ? await tx.projekt.findUnique({ where: { id: e.projektId } }) : null;
            if (!p || p.firmaId !== artikel.firmaId) throw new FachFehler("Projekt fehlt oder gehört zu einer anderen Firma.");
            projektId = p.id;
          }
          await genug(von.id, von.name);
          await aendern(von.id, -e.menge);
          const buchung = await tx.lagerBuchung.create({
            data: { ...basis, menge: e.menge, vonLagerId: von.id, projektId, ekPreis: artikel.durchschnittEk, wert: buchungswert(e.menge, artikel.durchschnittEk) },
          });
          if (projektId) {
            await tx.logbuchEintrag.create({
              data: { projektId, benutzerId: b.id, art: "SYSTEM", text: `Material entnommen: ${e.menge.toLocaleString("de-DE")} ${artikel.einheit} ${artikel.bezeichnung} aus ${von.name}` },
            });
          }
          return buchung;
        }
        case "UMBUCHUNG": {
          const von = await lagerLaden(e.vonLagerId, "Quelllager");
          const nach = await lagerLaden(e.nachLagerId, "Ziellager");
          if (von.id === nach.id) throw new FachFehler("Quell- und Ziellager sind gleich.");
          await genug(von.id, von.name);
          await aendern(von.id, -e.menge);
          await aendern(nach.id, e.menge);
          return tx.lagerBuchung.create({
            data: { ...basis, menge: e.menge, vonLagerId: von.id, nachLagerId: nach.id, ekPreis: artikel.durchschnittEk, wert: buchungswert(e.menge, artikel.durchschnittEk) },
          });
        }
        case "INVENTUR": {
          const lager = await lagerLaden(e.nachLagerId ?? e.vonLagerId, "Lager");
          const diff = Math.round((e.menge - (await bestand(lager.id))) * 1000) / 1000;
          if (diff === 0) throw new FachFehler("Der gezählte Bestand stimmt mit dem Buchbestand überein, keine Buchung nötig.");
          await aendern(lager.id, diff);
          return tx.lagerBuchung.create({
            data: { ...basis, menge: diff, nachLagerId: lager.id, ekPreis: artikel.durchschnittEk, wert: buchungswert(diff, artikel.durchschnittEk) },
          });
        }
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

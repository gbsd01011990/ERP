import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

const betrag = z.number().nonnegative();

export const LeistungEingabe = z.object({
  firmaId: z.string().min(1),
  nummer: z.string().trim().min(1, "Nummer ist Pflicht."),
  kurztext: z.string().trim().min(1, "Kurztext ist Pflicht."),
  kategorie: z.string().nullish(),
  langtext: z.string().nullish(),
  einheit: z.string().nullish(),
  minuten: betrag.default(0),
  materialEk: betrag.default(0),
  geraete: betrag.default(0),
  fremdEk: betrag.default(0),
  festpreis: betrag.nullish(),
  aktiv: z.boolean().default(true),
});
export type LeistungEingabe = z.input<typeof LeistungEingabe>;

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());

export async function leistungSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: LeistungEingabe) {
  rollePruefen(b);
  const e = LeistungEingabe.parse(eingabe);
  firmaPruefen(b, e.firmaId);
  const daten = { ...e, kategorie: leer(e.kategorie), langtext: leer(e.langtext), einheit: leer(e.einheit) ?? "Stk.", festpreis: e.festpreis ?? null };
  try {
    if (!id) return await db.leistung.create({ data: daten });
    const alt = await db.leistung.findUnique({ where: { id } });
    if (!alt) throw new FachFehler("Leistung nicht gefunden.", "NICHT_GEFUNDEN");
    firmaPruefen(b, alt.firmaId);
    return await db.leistung.update({ where: { id }, data: daten });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new FachFehler(`Die Nummer ${e.nummer} ist in dieser Firma schon vergeben.`);
    throw err;
  }
}

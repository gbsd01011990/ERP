import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { FachFehler } from "./fehler";
import { rollePruefen } from "./zugriff";

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());

export const KontaktEingabe = z.object({
  typ: z.enum(["KUNDE", "LIEFERANT", "PARTNER"]).default("KUNDE"),
  kategorie: z.enum(["PRIVAT", "GEWERBE", "OEFFENTLICH"]).default("PRIVAT"),
  firmenname: z.string().nullish(),
  anrede: z.string().nullish(),
  vorname: z.string().nullish(),
  nachname: z.string().nullish(),
  email: z.string().nullish(),
  telefon: z.string().nullish(),
  mobil: z.string().nullish(),
  leitwegId: z.string().nullish(),
  notiz: z.string().nullish(),
  strasse: z.string().nullish(),
  plz: z.string().nullish(),
  ort: z.string().nullish(),
});
export type KontaktEingabe = z.input<typeof KontaktEingabe>;

/** Legt einen Kontakt an (id = null) oder ändert ihn. Adresse = Hauptadresse. */
export async function kontaktSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: KontaktEingabe) {
  rollePruefen(b);
  const e = KontaktEingabe.parse(eingabe);
  const daten = {
    typ: e.typ, kategorie: e.kategorie,
    firmenname: leer(e.firmenname), anrede: leer(e.anrede), vorname: leer(e.vorname), nachname: leer(e.nachname),
    email: leer(e.email), telefon: leer(e.telefon), mobil: leer(e.mobil), leitwegId: leer(e.leitwegId), notiz: leer(e.notiz),
  };
  if (!daten.firmenname && !daten.nachname) throw new FachFehler("Firmenname oder Nachname angeben.");
  const adresse = { strasse: leer(e.strasse), plz: leer(e.plz), ort: leer(e.ort) };
  const hatAdresse = !!(adresse.strasse || adresse.ort || adresse.plz);

  if (!id) {
    return db.kontakt.create({ data: { ...daten, adressen: hatAdresse ? { create: { art: "HAUPT", ...adresse } } : undefined } });
  }
  const vorhanden = await db.kontakt.findUnique({ where: { id } });
  if (!vorhanden) throw new FachFehler("Kontakt nicht gefunden.", "NICHT_GEFUNDEN");
  const k = await db.kontakt.update({ where: { id }, data: daten });
  const haupt = await db.adresse.findFirst({ where: { kontaktId: id, art: "HAUPT" } });
  if (haupt) await db.adresse.update({ where: { id: haupt.id }, data: adresse });
  else if (hatAdresse) await db.adresse.create({ data: { kontaktId: id, art: "HAUPT", ...adresse } });
  return k;
}

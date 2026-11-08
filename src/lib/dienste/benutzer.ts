import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { PASSWORT_MINDESTLAENGE, type AktuellerBenutzer } from "../auth";
import { FachFehler } from "./fehler";
import { rollePruefen } from "./zugriff";

export const BenutzerEingabe = z.object({
  name: z.string().trim().min(1, "Name ist Pflicht."),
  email: z.string().trim().toLowerCase().email("Bitte eine gültige E-Mail-Adresse angeben."),
  rolle: z.enum(["ADMIN", "BUERO", "KOLONNE"]),
  aktiv: z.boolean().default(true),
  /** Mandanten (Firmen-IDs), auf die der Benutzer zugreifen darf */
  firmen: z.array(z.string()).min(1, "Mindestens einen Mandanten wählen."),
  /** Nur beim Anlegen oder zum Zurücksetzen */
  passwort: z.string().nullish(),
});

/**
 * Admin legt Benutzer an oder ändert sie. Ein Admin vergibt nur Mandanten, auf die er selbst
 * Zugriff hat (Gesamtliste aus der Datenbank, nicht nur der angemeldete Mandant).
 */
export async function benutzerSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: z.input<typeof BenutzerEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  const e = BenutzerEingabe.parse(eingabe);
  const eigeneFirmen = (await db.zugriff.findMany({ where: { benutzerId: b.id } })).map((z) => z.firmaId);
  if (e.firmen.some((f) => !eigeneFirmen.includes(f))) throw new FachFehler("Du kannst nur Mandanten vergeben, auf die du selbst Zugriff hast.", "KEIN_ZUGRIFF");
  if (e.passwort && e.passwort.length < PASSWORT_MINDESTLAENGE) throw new FachFehler(`Das Passwort braucht mindestens ${PASSWORT_MINDESTLAENGE} Zeichen.`);
  if (id === b.id && (e.rolle !== "ADMIN" || !e.aktiv || !e.firmen.includes(b.mandant.id))) {
    throw new FachFehler("Du kannst dir nicht selbst die Admin-Rolle oder den Zugang zu diesem Mandanten entziehen.");
  }

  const daten = { name: e.name, email: e.email, rolle: e.rolle, aktiv: e.aktiv };
  try {
    return await db.$transaction(async (tx) => {
      let benutzerId = id;
      if (!id) {
        if (!e.passwort) throw new FachFehler("Für neue Benutzer ist ein Startpasswort Pflicht.");
        const neu = await tx.benutzer.create({ data: { ...daten, passwortHash: await bcrypt.hash(e.passwort, 12) } });
        benutzerId = neu.id;
      } else {
        // Nur Benutzer bearbeiten, die einen der eigenen Mandanten teilen
        const geteilt = await tx.zugriff.findFirst({ where: { benutzerId: id, firmaId: { in: eigeneFirmen } } });
        if (!geteilt) throw new FachFehler("Benutzer nicht gefunden.", "NICHT_GEFUNDEN");
        await tx.benutzer.update({ where: { id }, data: { ...daten, ...(e.passwort ? { passwortHash: await bcrypt.hash(e.passwort, 12) } : {}) } });
        if (e.passwort || !e.aktiv) await tx.sitzung.deleteMany({ where: { benutzerId: id } }); // nach Zurücksetzen/Sperren neu anmelden
      }
      // Zugriffe auf die eigenen Mandanten neu setzen; fremde Mandanten bleiben unberührt
      await tx.zugriff.deleteMany({ where: { benutzerId: benutzerId!, firmaId: { in: eigeneFirmen } } });
      await tx.zugriff.createMany({ data: e.firmen.map((firmaId) => ({ benutzerId: benutzerId!, firmaId })) });
      await tx.sitzung.deleteMany({ where: { benutzerId: benutzerId!, firmaId: { notIn: e.firmen } } });
      return tx.benutzer.findUniqueOrThrow({ where: { id: benutzerId! } });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new FachFehler(`Die E-Mail-Adresse ${e.email} ist schon vergeben.`);
    throw err;
  }
}

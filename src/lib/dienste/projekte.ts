import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteNummer } from "../nummern";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

const leer = (s: string | null | undefined) => (s == null || s.trim() === "" ? null : s.trim());

export const ProjektEingabe = z.object({
  firmaId: z.string().min(1),
  kontaktId: z.string().min(1),
  titel: z.string().trim().min(1, "Titel ist Pflicht."),
  typId: z.string().nullish(),
  quelle: z.string().nullish(),
  beschreibung: z.string().nullish(),
  volumen: z.number().nonnegative().nullish(),
  baustelleStrasse: z.string().nullish(),
  baustellePlz: z.string().nullish(),
  baustelleOrt: z.string().nullish(),
});
export type ProjektEingabe = z.input<typeof ProjektEingabe>;

export async function projektAnlegen(b: AktuellerBenutzer, eingabe: ProjektEingabe) {
  rollePruefen(b);
  const e = ProjektEingabe.parse(eingabe);
  firmaPruefen(b, e.firmaId);
  if (!(await db.kontakt.findUnique({ where: { id: e.kontaktId } }))) throw new FachFehler("Kunde nicht gefunden.", "NICHT_GEFUNDEN");
  if (e.typId) {
    const t = await db.projektTyp.findUnique({ where: { id: e.typId } });
    if (!t || t.firmaId !== e.firmaId) throw new FachFehler("Projekttyp passt nicht zur Firma.");
  }
  const ersterStatus = await db.pipelineStatus.findFirstOrThrow({ where: { firmaId: e.firmaId }, orderBy: { reihenfolge: "asc" } });

  return db.$transaction(async (tx) => {
    const nummer = await naechsteNummer(tx, e.firmaId, "PROJEKT");
    return tx.projekt.create({
      data: {
        firmaId: e.firmaId, nummer, titel: e.titel, kontaktId: e.kontaktId, statusId: ersterStatus.id,
        typId: leer(e.typId), quelle: leer(e.quelle), beschreibung: leer(e.beschreibung), volumen: e.volumen ?? null,
        baustelleStrasse: leer(e.baustelleStrasse), baustellePlz: leer(e.baustellePlz), baustelleOrt: leer(e.baustelleOrt),
        verantwortlichId: b.id,
        logbuch: { create: { art: "SYSTEM", text: "Projekt angelegt", benutzerId: b.id } },
      },
    });
  });
}

async function projektLaden(b: AktuellerBenutzer, projektId: string) {
  const p = await db.projekt.findUnique({ where: { id: projektId } });
  if (!p) throw new FachFehler("Projekt nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, p.firmaId);
  return p;
}

export async function projektStatusSetzen(b: AktuellerBenutzer, projektId: string, statusId: string) {
  const p = await projektLaden(b, projektId);
  const status = await db.pipelineStatus.findUnique({ where: { id: statusId } });
  if (!status || status.firmaId !== p.firmaId) throw new FachFehler("Status gehört nicht zur Firma des Projekts.");
  if (status.id === p.statusId) return p;
  return db.projekt.update({
    where: { id: p.id },
    data: { statusId: status.id, logbuch: { create: { art: "STATUS", text: `Status geändert: ${status.name}`, benutzerId: b.id } } },
  });
}

export const LogbuchArtEingabe = z.enum(["NOTIZ", "ANRUF", "EMAIL", "TERMIN"]);

export async function logbuchEintragen(b: AktuellerBenutzer, projektId: string, art: z.input<typeof LogbuchArtEingabe>, text: string) {
  const p = await projektLaden(b, projektId);
  const t = text.trim();
  if (!t) throw new FachFehler("Text ist leer.");
  return db.logbuchEintrag.create({ data: { projektId: p.id, benutzerId: b.id, art: LogbuchArtEingabe.parse(art), text: t } });
}

import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteNummer } from "../nummern";
import { nettoAktualisieren } from "../angebot";
import { VORLAGEN, briefanrede } from "../vorlagen";
import { datum } from "../format";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

export async function angebotAnlegen(b: AktuellerBenutzer, projektId: string) {
  rollePruefen(b);
  const projekt = await db.projekt.findUnique({ where: { id: projektId }, include: { firma: true, kontakt: true } });
  if (!projekt) throw new FachFehler("Projekt nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, projekt.firmaId);
  const f = projekt.firma;
  const gueltigBis = new Date(Date.now() + f.angebotGueltigTage * 864e5);
  const v = VORLAGEN[f.kuerzel] ?? VORLAGEN.GBSD;

  return db.$transaction(async (tx) => {
    const nummer = await naechsteNummer(tx, f.id, "ANGEBOT");
    const neu = await tx.angebot.create({
      data: {
        firmaId: f.id, projektId: projekt.id, nummer,
        betreff: projekt.baustelleOrt
          ? `BV: ${[projekt.baustelleStrasse, projekt.baustelleOrt].filter(Boolean).join(", ")} – ${projekt.titel}`
          : projekt.titel,
        anrede: briefanrede(projekt.kontakt),
        einleitung: v.einleitung(datum(gueltigBis)),
        vorbemerkung: v.vorbemerkung ?? null,
        schlusstext: v.schlusstext ?? null,
        gueltigBis, mwstSatz: f.mwstSatz, stundensatz: f.stundensatz,
        materialAufschlag: f.materialAufschlag, fremdAufschlag: f.fremdAufschlag, erstelltVonId: b.id,
      },
    });
    await tx.logbuchEintrag.create({ data: { projektId: projekt.id, benutzerId: b.id, art: "SYSTEM", text: `Angebot ${nummer} angelegt` } });
    return neu;
  });
}

export async function angebotEntwurfLaden(b: AktuellerBenutzer, angebotId: string) {
  rollePruefen(b);
  const a = await db.angebot.findUnique({ where: { id: angebotId } });
  if (!a) throw new FachFehler("Angebot nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, a.firmaId);
  if (a.status !== "ENTWURF") throw new FachFehler("Nur Entwürfe lassen sich bearbeiten. Lege eine neue Version an.");
  return a;
}

const betrag = z.number().nonnegative();
export const PositionEingabe = z.object({
  art: z.enum(["GRUPPE", "POSITION", "TEXT"]).default("POSITION"),
  leistungId: z.string().nullish(),
  kurztext: z.string().nullish(),
  langtext: z.string().nullish(),
  menge: betrag.nullish(),
  einheit: z.string().nullish(),
  minuten: betrag.nullish(),
  materialEk: betrag.nullish(),
  geraete: betrag.nullish(),
  fremdEk: betrag.nullish(),
  einzelpreis: betrag.nullish(),
  bedarf: z.boolean().nullish(),
});
export type PositionEingabe = z.input<typeof PositionEingabe>;

/** Hängt eine Position an. Mit leistungId werden Texte und Kalkulation aus dem Leistungsstamm übernommen. */
export async function positionHinzufuegen(b: AktuellerBenutzer, angebotId: string, eingabe: PositionEingabe) {
  const a = await angebotEntwurfLaden(b, angebotId);
  const e = PositionEingabe.parse(eingabe);
  const letzte = await db.angebotsPosition.findFirst({ where: { angebotId: a.id }, orderBy: { reihenfolge: "desc" } });
  const basis = { angebotId: a.id, reihenfolge: (letzte?.reihenfolge ?? 0) + 10, art: e.art };

  if (e.art === "POSITION" && e.leistungId) {
    const l = await db.leistung.findUnique({ where: { id: e.leistungId } });
    if (!l || l.firmaId !== a.firmaId) throw new FachFehler("Leistung nicht gefunden oder aus anderer Firma.");
    await db.angebotsPosition.create({
      data: {
        ...basis, leistungId: l.id,
        kurztext: e.kurztext?.trim() || l.kurztext, langtext: e.langtext ?? l.langtext, einheit: e.einheit ?? l.einheit,
        menge: e.menge ?? 1,
        minuten: l.minuten, materialEk: l.materialEk, geraete: l.geraete, fremdEk: l.fremdEk,
        einzelpreis: e.einzelpreis ?? l.festpreis ?? 0, preisFest: e.einzelpreis != null || l.festpreis != null,
        bedarf: e.bedarf ?? false,
      },
    });
  } else {
    const standard = { GRUPPE: "Neuer Titel", POSITION: "Neue Position", TEXT: "Hinweis" }[e.art];
    await db.angebotsPosition.create({
      data: {
        ...basis, kurztext: e.kurztext?.trim() || standard, langtext: e.langtext ?? null,
        ...(e.art === "POSITION"
          ? {
              menge: e.menge ?? 1, einheit: e.einheit ?? "Stk.",
              minuten: e.minuten ?? 0, materialEk: e.materialEk ?? 0, geraete: e.geraete ?? 0, fremdEk: e.fremdEk ?? 0,
              einzelpreis: e.einzelpreis ?? 0, preisFest: e.einzelpreis != null, bedarf: e.bedarf ?? false,
            }
          : {}),
      },
    });
  }
  await nettoAktualisieren(a.id);
  return a;
}

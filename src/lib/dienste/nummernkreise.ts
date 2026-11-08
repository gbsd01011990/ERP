import { z } from "zod";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { naechsteVorschau } from "../nummern";
import { FachFehler } from "./fehler";
import { firmaPruefen, rollePruefen } from "./zugriff";

export const ART_TEXT: Record<string, string> = {
  RECHNUNG: "Rechnungen (auch Storno und Korrektur)", ANGEBOT: "Angebote", AUFTRAG: "Auftragsbestätigungen",
  PROJEKT: "Projekte", AUFMASS: "Aufmaße", LIEFERSCHEIN: "Lieferscheine",
};

export const KreisEingabe = z.object({
  praefix: z.string().max(30),
  naechste: z.number().int().min(1, "Die nächste Nummer muss mindestens 1 sein."),
  stellen: z.number().int().min(1).max(10),
  jahresweise: z.boolean(),
});

/**
 * Nummernkreis frei anpassen. Für Rechnungen wird geprüft, dass die nächste Nummer
 * noch nicht vergeben ist – sonst entstünde eine doppelte Rechnungsnummer.
 */
export async function kreisSpeichern(b: AktuellerBenutzer, id: string, eingabe: z.input<typeof KreisEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  const k = await db.nummernkreis.findUnique({ where: { id } });
  if (!k) throw new FachFehler("Nummernkreis nicht gefunden.", "NICHT_GEFUNDEN");
  firmaPruefen(b, k.firmaId);
  const e = KreisEingabe.parse(eingabe);
  const neu = { ...k, ...e };
  const vorschau = naechsteVorschau(neu);
  if (k.art === "RECHNUNG") {
    const belegt = await db.rechnung.findFirst({ where: { firmaId: k.firmaId, nummer: vorschau }, select: { id: true } });
    if (belegt) throw new FachFehler(`Die Rechnungsnummer ${vorschau} ist schon vergeben. Wähle eine höhere nächste Nummer.`);
  }
  await db.nummernkreis.update({ where: { id }, data: e });
  return vorschau;
}

export const ZahlungEingabe = z.object({
  zahlungszielTage: z.number().int().min(0).max(365),
  skontoProzent: z.number().min(0).max(100),
  skontoTage: z.number().int().min(0).max(365),
});

export async function zahlungsVorgabenSpeichern(b: AktuellerBenutzer, eingabe: z.input<typeof ZahlungEingabe>) {
  rollePruefen(b, ["ADMIN"]);
  await db.firma.update({ where: { id: b.mandant.id }, data: ZahlungEingabe.parse(eingabe) });
}

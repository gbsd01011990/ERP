import { n, runden } from "../kalkulation";

type Zahl = Parameters<typeof n>[0];

export type MaschinenDaten = {
  anschaffungspreis: Zahl;
  nutzungsdauerJahre: Zahl;
  einsatzstundenJahr: Zahl;
  zinsProzent: Zahl;
  reparaturProzent: Zahl;
  fixkostenJahr: Zahl;
  betriebskostenStd: Zahl;
  verrechnungssatz?: Zahl;
};

/**
 * Maschinenstundensatz nach dem üblichen Schema (angelehnt an die BGL):
 *   Abschreibung  = Anschaffung / Nutzungsdauer
 *   Verzinsung    = Anschaffung / 2 × Zins %
 *   Reparatur     = Anschaffung × Reparatur %
 *   Fixkosten     = Versicherung, Steuer, Unterstellung
 *   Satz          = (Summe Jahreskosten) / Einsatzstunden + Betriebskosten je Stunde
 * Ohne Einsatzstunden lässt sich kein Satz bilden (null).
 */
export function maschinensatz(d: MaschinenDaten) {
  const a = n(d.anschaffungspreis);
  const jahre = n(d.nutzungsdauerJahre);
  const std = n(d.einsatzstundenJahr);
  const afa = jahre > 0 ? a / jahre : 0;
  const zins = (a / 2) * (n(d.zinsProzent) / 100);
  const reparatur = a * (n(d.reparaturProzent) / 100);
  const fix = n(d.fixkostenJahr);
  const jahreskosten = afa + zins + reparatur + fix;
  const kalkuliert = std > 0 ? runden(jahreskosten / std + n(d.betriebskostenStd)) : null;
  const fest = d.verrechnungssatz == null ? null : n(d.verrechnungssatz);
  return {
    afa: runden(afa), zins: runden(zins), reparatur: runden(reparatur), fix: runden(fix),
    jahreskosten: runden(jahreskosten), kalkuliert,
    /** Satz für Einsätze: fester Verrechnungssatz vor Kalkulation, sonst 0 */
    wirksam: fest ?? kalkuliert ?? 0,
  };
}

/** Nächste Fälligkeit: letzte Prüfung + Intervall. Monatsende wird berücksichtigt (31.01. + 1 Monat = 28./29.02.). */
export function naechsteFaelligkeit(letzteAm: Date | null, intervallMonate: number | null) {
  if (!letzteAm || !intervallMonate) return null;
  const d = new Date(letzteAm);
  const tag = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + intervallMonate);
  const letzterTag = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(tag, letzterTag));
  return d;
}

export type Ampel = "ueberfaellig" | "bald" | "ok" | "offen";

/** Ampel für Prüfungen: überfällig, in den nächsten 30 Tagen fällig, ok, oder ohne Termin. */
export function pruefAmpel(naechsteAm: Date | null, heute = new Date(), vorlaufTage = 30): Ampel {
  if (!naechsteAm) return "offen";
  const diff = (naechsteAm.getTime() - heute.getTime()) / 864e5;
  if (diff < 0) return "ueberfaellig";
  if (diff <= vorlaufTage) return "bald";
  return "ok";
}

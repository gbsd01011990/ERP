import { n, runden } from "../kalkulation";

type Zahl = Parameters<typeof n>[0];

/**
 * Gleitender Durchschnittspreis nach einem Zugang.
 * Bei leerem oder negativem Altbestand gilt der neue EK.
 */
export function neuerDurchschnitt(bestandVorher: Zahl, ekVorher: Zahl, zugang: Zahl, ekZugang: Zahl) {
  const b = n(bestandVorher), z = n(zugang);
  if (z <= 0) return n(ekVorher);
  if (b <= 0) return n(ekZugang);
  return Math.round(((b * n(ekVorher) + z * n(ekZugang)) / (b + z)) * 10000) / 10000;
}

export const buchungswert = (menge: Zahl, preis: Zahl) => runden(n(menge) * n(preis));

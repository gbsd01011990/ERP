import { n, runden } from "../kalkulation";

type Zahl = Parameters<typeof n>[0];

export type PlanDaten = {
  mitarbeiter: Zahl;
  bezahlteStundenJahr: Zahl;
  produktivProzent: Zahl;
  mittellohn: Zahl;
  lohnnebenkostenProzent: Zahl;
  materialEinsatzJahr: Zahl;
  fremdEinsatzJahr: Zahl;
  wagnisGewinnProzent: Zahl;
};
export type PlanZeile = { betragJahr: Zahl; verteilung: "LOHN" | "MATERIAL" | "FREMD" };

/**
 * Plankostenrechnung für einen Handwerksbetrieb (Zuschlagskalkulation).
 *
 *   bezahlte Stunden    = Mitarbeiter × bezahlte Stunden je MA
 *   produktive Stunden  = bezahlte Stunden × Produktivanteil
 *   Lohnkosten Jahr     = bezahlte Stunden × Mittellohn × (1 + Lohnnebenkosten %)
 *   Lohn je prod. Std   = Lohnkosten Jahr / produktive Stunden
 *   GK je prod. Std     = Gemeinkosten (Verteilung LOHN) / produktive Stunden
 *   Stundenverrechnungssatz = (Lohn + GK je Std) × (1 + Wagnis und Gewinn %)
 *   Materialzuschlag %  = ((1 + GK Material / Materialeinsatz) × (1 + W&G %) − 1) × 100
 *   Fremdzuschlag %     = analog mit Fremdleistung
 */
export function planErgebnis(p: PlanDaten, zeilen: PlanZeile[]) {
  const bezahlt = n(p.mitarbeiter) * n(p.bezahlteStundenJahr);
  const produktiv = bezahlt * (n(p.produktivProzent) / 100);
  const lohnkosten = bezahlt * n(p.mittellohn) * (1 + n(p.lohnnebenkostenProzent) / 100);
  const summe = (v: PlanZeile["verteilung"]) => zeilen.filter((z) => z.verteilung === v).reduce((s, z) => s + n(z.betragJahr), 0);
  const gkLohn = summe("LOHN"), gkMaterial = summe("MATERIAL"), gkFremd = summe("FREMD");
  const wg = 1 + n(p.wagnisGewinnProzent) / 100;

  const lohnJeStd = produktiv > 0 ? lohnkosten / produktiv : 0;
  const gkJeStd = produktiv > 0 ? gkLohn / produktiv : 0;
  const selbstkostenJeStd = lohnJeStd + gkJeStd;
  const stundensatz = produktiv > 0 ? runden(selbstkostenJeStd * wg) : null;
  const zuschlag = (gk: number, einsatz: number) => (einsatz > 0 ? runden(((1 + gk / einsatz) * wg - 1) * 100) : runden((wg - 1) * 100));
  const materialAufschlag = zuschlag(gkMaterial, n(p.materialEinsatzJahr));
  const fremdAufschlag = zuschlag(gkFremd, n(p.fremdEinsatzJahr));

  const umsatzLohn = stundensatz ? produktiv * stundensatz : 0;
  const umsatzMaterial = n(p.materialEinsatzJahr) * (1 + materialAufschlag / 100);
  const umsatzFremd = n(p.fremdEinsatzJahr) * (1 + fremdAufschlag / 100);
  const kostenGesamt = lohnkosten + gkLohn + gkMaterial + gkFremd + n(p.materialEinsatzJahr) + n(p.fremdEinsatzJahr);
  const umsatz = umsatzLohn + umsatzMaterial + umsatzFremd;

  return {
    bezahlteStunden: Math.round(bezahlt),
    produktiveStunden: Math.round(produktiv),
    lohnkosten: runden(lohnkosten),
    gemeinkosten: { lohn: runden(gkLohn), material: runden(gkMaterial), fremd: runden(gkFremd), gesamt: runden(gkLohn + gkMaterial + gkFremd) },
    lohnJeStd: runden(lohnJeStd),
    gkJeStd: runden(gkJeStd),
    selbstkostenJeStd: runden(selbstkostenJeStd),
    stundensatz,
    materialAufschlag,
    fremdAufschlag,
    planumsatz: runden(umsatz),
    plankosten: runden(kostenGesamt),
    planergebnis: runden(umsatz - kostenGesamt),
  };
}

/**
 * Rechnungsprüfung für Eingangsrechnungen. Reine Funktion ohne Datenbank.
 *
 * - formal: Pflichtangaben nach § 14 UStG, Empfänger ist unsere Firma
 * - rechnerisch: Positionen, Steuer, Brutto und Zahlbetrag stimmen
 * - Bestellabgleich (Dreiweg): berechnet ≤ geliefert ≤ bestellt, Preis höchstens wie bestellt
 * - Sicherheit: doppelte Rechnung, geänderte Bankverbindung
 */

export type Status = "ok" | "hinweis" | "warnung" | "fehler";
export type Regel = { gruppe: "formal" | "rechnerisch" | "bestellung" | "sicherheit"; status: Status; text: string };

export type PruefKopf = {
  rechnungsnummer: string | null; datum: string | null; leistungsdatum: string | null;
  netto: number; mwst: number; brutto: number; vorauszahlung: number; zahlbetrag: number; summePositionen: number | null;
  iban: string | null;
  lieferant: { name: string | null; ustId: string | null; steuernummer: string | null; strasse: string | null; plz: string | null; ort: string | null };
  kaeufer: { name: string | null };
};
export type PruefSteuer = { basis: number; betrag: number; kategorie: string | null; satz: number | null };
export type PruefPosition = { nr: number; artNr: string | null; text: string; menge: number; preis: number; gesamt: number };
export type BestellPos = { id: string; artNr: string | null; text: string; menge: number; geliefert: number; berechnetVorher: number; preis: number };

export type PruefEingabe = {
  kopf: PruefKopf; steuern: PruefSteuer[]; positionen: PruefPosition[];
  elektronisch: boolean; xsdOk: boolean | null; xsdFehler?: string | null;
  firmaName: string;
  doppelt: { nummer: string; datum: string | null } | null;
  bekannteIbans: string[];
  bestellung: { nummer: string | null; positionen: BestellPos[] } | null;
  toleranzProzent: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const gleich = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;
const eur = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const zahl = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 3 });
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/gmbh|&|und|\.|,|-|\s/g, "");
const ibanNorm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").toUpperCase();
const textNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");

/** Rechnungszeilen den Bestellpositionen zuordnen: Artikelnummer, dann Text, dann Reihenfolge. */
export function zuordnen(positionen: PruefPosition[], bestellt: BestellPos[]) {
  const z = new Map<number, string | null>();
  const frei = new Set(bestellt.map((b) => b.id));
  for (const p of positionen) {
    const a = p.artNr ? bestellt.find((b) => b.artNr && textNorm(b.artNr) === textNorm(p.artNr!)) : undefined;
    if (a) { z.set(p.nr, a.id); frei.delete(a.id); }
  }
  for (const p of positionen) {
    if (z.has(p.nr)) continue;
    const t = textNorm(p.text);
    const b = bestellt.find((x) => frei.has(x.id) && t.length >= 4 && (textNorm(x.text) === t || textNorm(x.text).includes(t) || t.includes(textNorm(x.text))));
    if (b) { z.set(p.nr, b.id); frei.delete(b.id); }
  }
  // Gleiche Anzahl und keine Treffer: nach Reihenfolge
  const offen = positionen.filter((p) => !z.has(p.nr));
  const restB = bestellt.filter((b) => frei.has(b.id));
  if (offen.length && offen.length === restB.length && z.size === 0) offen.forEach((p, i) => z.set(p.nr, restB[i].id));
  for (const p of positionen) if (!z.has(p.nr)) z.set(p.nr, null);
  return z;
}

export function pruefen(e: PruefEingabe) {
  const regeln: Regel[] = [];
  const add = (gruppe: Regel["gruppe"], status: Status, text: string) => regeln.push({ gruppe, status, text });
  const k = e.kopf;

  // ---------------- formal
  if (e.elektronisch) {
    if (e.xsdOk === false) add("formal", "warnung", `E-Rechnung verletzt das Schema: ${(e.xsdFehler ?? "").slice(0, 200)}`);
    else add("formal", "ok", "E-Rechnung gelesen, Schema gültig");
  } else add("formal", "hinweis", "Papier- bzw. PDF-Rechnung ohne strukturierte Daten. Ab 2027/2028 dürfen Lieferanten mit Umsatz über 800.000 € nur noch E-Rechnungen schicken.");
  if (!k.rechnungsnummer) add("formal", "fehler", "Rechnungsnummer fehlt");
  if (!k.datum) add("formal", "fehler", "Rechnungsdatum fehlt");
  if (!k.lieferant.name || !k.lieferant.ort) add("formal", "fehler", "Name oder Anschrift des Lieferanten fehlt");
  if (!k.lieferant.ustId && !k.lieferant.steuernummer) add("formal", e.elektronisch ? "fehler" : "warnung", "USt-IdNr. oder Steuernummer des Lieferanten fehlt (§ 14 UStG) – ohne sie kein Vorsteuerabzug");
  if (!k.leistungsdatum) add("formal", "warnung", "Liefer- oder Leistungsdatum fehlt (§ 14 Abs. 4 Nr. 6 UStG); bei Rechnungen „Leistungsdatum = Rechnungsdatum“ reicht ein Hinweis darauf");
  if (k.kaeufer.name && !norm(k.kaeufer.name).includes(norm(e.firmaName).slice(0, 8))) {
    add("formal", "warnung", `Rechnung ist an „${k.kaeufer.name}“ adressiert, nicht an ${e.firmaName}`);
  }
  const ae = e.steuern.some((s) => s.kategorie === "AE");
  if (ae) add("formal", "hinweis", "Steuerschuldnerschaft des Leistungsempfängers (§ 13b): wir führen die Umsatzsteuer ab");

  // ---------------- rechnerisch
  if (e.positionen.length) {
    const summe = r2(e.positionen.reduce((s, p) => s + p.gesamt, 0));
    const soll = k.summePositionen ?? k.netto;
    if (!gleich(summe, soll)) add("rechnerisch", "fehler", `Summe der Positionen ${eur(summe)} weicht von ${eur(soll)} ab`);
    for (const p of e.positionen) {
      if (p.preis && !gleich(r2(p.menge * p.preis), p.gesamt, Math.max(0.011, Math.abs(p.gesamt) * 0.0001))) {
        add("rechnerisch", "warnung", `Position ${p.nr}: ${zahl(p.menge)} × ${eur(p.preis)} ergibt nicht ${eur(p.gesamt)}`);
      }
    }
  }
  for (const s of e.steuern) {
    if (s.satz != null && !gleich(r2((s.basis * s.satz) / 100), s.betrag)) add("rechnerisch", "fehler", `Steuer ${zahl(s.satz)} %: ${eur(s.basis)} ergibt ${eur(r2((s.basis * s.satz) / 100))}, berechnet sind ${eur(s.betrag)}`);
  }
  if (e.steuern.length && !gleich(r2(e.steuern.reduce((x, s) => x + s.betrag, 0)), k.mwst)) add("rechnerisch", "fehler", "Summe der Steuerbeträge stimmt nicht mit der Gesamtsteuer überein");
  if (!gleich(r2(k.netto + k.mwst), k.brutto)) add("rechnerisch", "fehler", `Netto ${eur(k.netto)} + Steuer ${eur(k.mwst)} ergibt nicht ${eur(k.brutto)}`);
  if (!gleich(r2(k.brutto - k.vorauszahlung), k.zahlbetrag)) add("rechnerisch", "fehler", `Zahlbetrag ${eur(k.zahlbetrag)} passt nicht zu Brutto ${eur(k.brutto)} abzüglich Vorauszahlung ${eur(k.vorauszahlung)}`);
  if (!regeln.some((r) => r.gruppe === "rechnerisch")) add("rechnerisch", "ok", "Beträge rechnerisch richtig");

  // ---------------- Bestellabgleich
  let zuordnung = new Map<number, string | null>();
  if (e.bestellung) {
    const b = e.bestellung;
    zuordnung = zuordnen(e.positionen, b.positionen);
    const proPos = new Map<string, { menge: number; preise: number[] }>();
    for (const p of e.positionen) {
      const id = zuordnung.get(p.nr);
      if (!id) { add("bestellung", "warnung", `Position ${p.nr} „${p.text}“ (${eur(p.gesamt)}) steht nicht in Bestellung ${b.nummer ?? ""}`); continue; }
      const x = proPos.get(id) ?? { menge: 0, preise: [] };
      x.menge += p.menge; x.preise.push(p.preis); proPos.set(id, x);
    }
    for (const bp of b.positionen) {
      const x = proPos.get(bp.id);
      if (!x) continue;
      const gesamtBerechnet = Math.round((bp.berechnetVorher + x.menge) * 1000) / 1000;
      if (gesamtBerechnet > bp.menge + 1e-6) add("bestellung", "fehler", `„${bp.text}“: ${zahl(gesamtBerechnet)} berechnet, aber nur ${zahl(bp.menge)} bestellt`);
      else if (gesamtBerechnet > bp.geliefert + 1e-6) add("bestellung", "warnung", `„${bp.text}“: ${zahl(gesamtBerechnet)} berechnet, aber erst ${zahl(bp.geliefert)} als geliefert erfasst. Wareneingang buchen oder Lieferung klären.`);
      const teuerster = Math.max(...x.preise);
      if (bp.preis > 0 && teuerster > bp.preis * (1 + e.toleranzProzent / 100) + 0.0001) {
        add("bestellung", "warnung", `„${bp.text}“: Preis ${eur(teuerster)} statt bestellt ${eur(bp.preis)} (+${zahl(Math.round(((teuerster - bp.preis) / bp.preis) * 1000) / 10)} %)`);
      }
    }
    if (!e.positionen.length) add("bestellung", "hinweis", "Ohne Positionen kein Abgleich mit der Bestellung möglich – bitte von Hand prüfen");
    if (!regeln.some((r) => r.gruppe === "bestellung")) add("bestellung", "ok", `Passt zu Bestellung ${b.nummer ?? ""}: Mengen und Preise wie bestellt und geliefert`);
  } else add("bestellung", "hinweis", "Keine Bestellung zugeordnet – sachliche Richtigkeit bitte bestätigen lassen");

  // ---------------- Sicherheit
  if (e.doppelt) add("sicherheit", "fehler", `Rechnung ${e.doppelt.nummer} dieses Lieferanten ist schon erfasst${e.doppelt.datum ? ` (vom ${e.doppelt.datum})` : ""}`);
  const iban = ibanNorm(k.iban);
  if (iban && e.bekannteIbans.length && !e.bekannteIbans.map(ibanNorm).includes(iban)) {
    add("sicherheit", "fehler", `Neue Bankverbindung ${iban}. Bisher zahlten wir auf ${e.bekannteIbans.map(ibanNorm).join(", ")}. Vor der Zahlung telefonisch beim Lieferanten bestätigen (Betrugsmasche).`);
  }
  if (!regeln.some((r) => r.gruppe === "sicherheit")) add("sicherheit", "ok", "Keine doppelte Rechnung, Bankverbindung unverändert");

  const ergebnis: Status = regeln.some((r) => r.status === "fehler") ? "fehler" : regeln.some((r) => r.status === "warnung") ? "warnung" : "ok";
  return { regeln, ergebnis, zuordnung: Object.fromEntries(zuordnung) as Record<number, string | null>, steuerUmkehr: ae };
}

export type Pruefergebnis = ReturnType<typeof pruefen>;

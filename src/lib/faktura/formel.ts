/**
 * Rechenansätze im Mengennachweis (REB 23.003): Grundrechenarten, Klammern,
 * Potenz (^), Dezimalkomma, PI und WURZEL(x). Kein eval – eigener Parser.
 * "12,5*3,2 - 2*(0,8*0,8)" → 38,72
 */
export class FormelFehler extends Error {}

export function formelBerechnen(eingabe: string): number {
  const s = eingabe.replace(/\s+/g, "").replace(/,/g, ".").replace(/[x×]/gi, "*").replace(/:/g, "/").toUpperCase();
  if (!s) throw new FormelFehler("Leere Formel");
  let i = 0;
  const fehler = (t: string) => new FormelFehler(`${t} in „${eingabe}“`);

  const zahl = (): number => {
    if (s.startsWith("PI", i)) { i += 2; return Math.PI; }
    if (s.startsWith("WURZEL(", i)) {
      i += 7;
      const v = summe();
      if (s[i] !== ")") throw fehler("Klammer fehlt");
      i++;
      if (v < 0) throw fehler("Wurzel aus negativer Zahl");
      return Math.sqrt(v);
    }
    if (s[i] === "(") {
      i++;
      const v = summe();
      if (s[i] !== ")") throw fehler("Klammer fehlt");
      i++;
      return v;
    }
    if (s[i] === "-") { i++; return -faktor(); }
    if (s[i] === "+") { i++; return faktor(); }
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (!m) throw fehler(`Unerwartetes Zeichen „${s[i] ?? "Ende"}“`);
    i += m[0].length;
    return Number(m[0]);
  };
  const faktor = (): number => {
    const b = zahl();
    if (s[i] === "^") { i++; return Math.pow(b, faktor()); }
    return b;
  };
  const produkt = (): number => {
    let v = faktor();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const r = faktor();
      if (op === "/" && r === 0) throw fehler("Division durch null");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const summe = (): number => {
    let v = produkt();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = produkt();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };

  const v = summe();
  if (i < s.length) throw fehler(`Unerwartetes Zeichen „${s[i]}“`);
  if (!Number.isFinite(v)) throw fehler("Ergebnis ist keine Zahl");
  return Math.round(v * 1000) / 1000;
}

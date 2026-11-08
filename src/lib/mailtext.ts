/** Hilfen für E-Mail-Inhalte: HTML → Klartext, Adressen normalisieren. Keine Abhängigkeiten, gut testbar. */

const ENTITAETEN: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", euro: "€", ndash: "–", mdash: "—", hellip: "…" };

/** HTML einer Mail in lesbaren Klartext umwandeln (Absätze, Zeilenumbrüche, Links als „Text (URL)“). */
export function htmlZuText(html: string) {
  let t = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url: string, txt: string) => {
      const sichtbar = txt.replace(/<[^>]+>/g, "").trim();
      return sichtbar && !url.startsWith("mailto:") && sichtbar !== url ? `${sichtbar} (${url})` : sichtbar || url;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITAETEN[e] ?? m,
    );
  t = t.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export const adresseNormal = (a?: string | null) => (a ?? "").trim().toLowerCase();

/** Klartext für eine Antwort zitieren. */
export function zitat(text: string, von: string, am: string) {
  return `\n\n\nAm ${am} schrieb ${von}:\n` + text.split("\n").map((z) => `> ${z}`).join("\n");
}

/** Klartext → einfaches HTML zum Versenden (Zeilenumbrüche, Links bleiben Text). */
export function textZuHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,sans-serif;font-size:10.5pt">${esc.replace(/\n/g, "<br>")}</div>`;
}

/** „Max Muster <max@x.de>, info@y.de“ → Liste gültiger Adressen; ungültige werden gemeldet. */
export function adressenLesen(eingabe: string) {
  const teile = eingabe.split(/[;,\n]/).map((t) => t.trim()).filter(Boolean);
  const gueltig: string[] = [], ungueltig: string[] = [];
  for (const t of teile) {
    const m = t.match(/<([^>]+)>/);
    const a = adresseNormal(m ? m[1] : t);
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a) ? gueltig : ungueltig).push(m ? m[1] : t);
  }
  return { gueltig: [...new Set(gueltig.map(adresseNormal))], ungueltig };
}

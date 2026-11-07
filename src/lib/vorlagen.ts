/** Standardtexte je Firma für neue Angebote. Werden beim Anlegen kopiert und sind danach frei editierbar. */
type Vorlage = { einleitung: (gueltig: string) => string; vorbemerkung?: string; schlusstext?: string };

export const VORLAGEN: Record<string, Vorlage> = {
  GBSD: {
    einleitung: () => "vielen Dank für Ihre Anfrage. Gern bieten wir Ihnen die folgenden Leistungen an.",
    schlusstext: "Das Angebot gilt 14 Tage. Für Rückfragen erreichen Sie uns unter 03327 7407716.",
  },
  RD: {
    einleitung: (g) => `wir bedanken uns für die Anfrage und unterbreiten Ihnen das nachstehende Angebot, welches bis zum ${g} gültig ist.`,
  },
  KUD: {
    einleitung: (g) => `wir bedanken uns für die Anfrage und unterbreiten Ihnen das nachstehende Angebot, welches bis zum ${g} gültig ist.`,
    vorbemerkung: [
      "Alleiniger Vertragsbestandteil ist die VOB (Vergabe- und Vertragsordnung für Bauleistungen in neuester Fassung in den Teilen B und C). Grundlage der Definition und Ausführungsqualität ist die ZTV-Baumpflege, neueste Fassung.",
      "Alle genannten Einzelpreise sind Nettopreise. Die jeweilige zum Zeitpunkt der Rechnungsstellung gültige Mehrwertsteuer muss zum Gesamtnettopreis hinzugerechnet werden.",
      "Etwaige notwendige Genehmigungen aufgrund von Naturschutzgesetzen und Baumschutzverordnungen sind vom Baumeigentümer von zuständiger Stelle einzuholen.",
      "Bitte beauftragen Sie uns nur schriftlich, Sie können dazu den beiliegenden Vordruck benutzen.",
      "Abschließend bitten wir Sie zu beachten, dass wir Ihre Daten speichern und verarbeiten – Anlass hierfür ist die Bearbeitung Ihres Angebots. Nähere Informationen zur Datenverarbeitung und Ihren Rechten erhalten Sie im Internet unter www.kusche-dremel.de/datenschutz.",
    ].join("\n\n"),
  },
};

type K = { anrede?: string | null; vorname?: string | null; nachname?: string | null; firmenname?: string | null };

export function briefanrede(k: K) {
  const a = (k.anrede ?? "").toLowerCase();
  if (k.nachname && a.startsWith("frau")) return `Sehr geehrte Frau ${k.nachname},`;
  if (k.nachname && a.startsWith("herr")) return `Sehr geehrter Herr ${k.nachname},`;
  if (k.nachname && a.startsWith("familie")) return `Sehr geehrte Familie ${k.nachname},`;
  return "Sehr geehrte Damen und Herren,";
}

type A = { strasse?: string | null; plz?: string | null; ort?: string | null } | undefined;

/** Anschriftenfeld. RD und KUD setzen die Anrede in eine eigene Zeile (wie in ihren Mustern). */
export function empfaengerZeilen(kuerzel: string, k: K, a: A) {
  const person = [k.vorname, k.nachname].filter(Boolean).join(" ");
  const zeilen: string[] = [];
  if (k.firmenname) {
    zeilen.push(k.firmenname);
    if (person) zeilen.push(`${k.anrede ? k.anrede + " " : ""}${person}`);
  } else if (kuerzel === "GBSD") {
    zeilen.push([k.anrede, person].filter(Boolean).join(" "));
  } else {
    if (k.anrede) zeilen.push(k.anrede);
    zeilen.push(person);
  }
  if (a?.strasse) zeilen.push(a.strasse);
  if (a?.plz || a?.ort) zeilen.push([a?.plz, a?.ort].filter(Boolean).join(" "));
  return zeilen.filter(Boolean);
}

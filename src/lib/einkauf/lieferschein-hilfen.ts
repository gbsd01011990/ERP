/** Reine Hilfen für Lieferscheine (ohne Datenbank, testbar). */

/** Dateityp am Inhalt erkennen – der Name oder die Angabe des Browsers zählt nicht. */
export function dateiTyp(daten: Buffer): string | null {
  if (daten.length < 12) return null;
  if (daten[0] === 0xff && daten[1] === 0xd8 && daten[2] === 0xff) return "image/jpeg";
  if (daten.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (daten.subarray(0, 4).toString("latin1") === "RIFF" && daten.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (daten.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  const ftyp = daten.subarray(4, 12).toString("latin1");
  if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(ftyp)) return "image/heic";
  return null;
}

/** Lieferscheinnummer aus Betreff oder Dateiname („Lieferschein 4711“, „LS-4711“). */
export function nummerAusText(t: string) {
  return /(?:lieferschein|lieferschein-?nr\.?|\bls)[\s:#.-]*(?:nr\.?\s*)?([A-Z0-9][\w/-]{2,})/i.exec(t)?.[1] ?? null;
}

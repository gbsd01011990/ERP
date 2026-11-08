import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Verschlüsselung für gespeicherte Zugangsschlüssel (Microsoft-Tokens).
 * Schlüssel aus ERP_SCHLUESSEL (beliebige lange Zufallszeichenkette, z. B. openssl rand -hex 32).
 * Format: v1.<iv>.<tag>.<daten> (base64url), AES-256-GCM.
 */
function schluessel() {
  const s = process.env.ERP_SCHLUESSEL;
  if (!s || s.length < 32) throw new Error("ERP_SCHLUESSEL fehlt oder ist zu kurz (mind. 32 Zeichen) – nötig für die Microsoft-Anbindung.");
  return createHash("sha256").update(s).digest();
}

export function verschluesseln(klartext: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", schluessel(), iv);
  const daten = Buffer.concat([c.update(klartext, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), daten.toString("base64url")].join(".");
}

export function entschluesseln(geheim: string) {
  const [v, iv, tag, daten] = geheim.split(".");
  if (v !== "v1" || !iv || !tag || !daten) throw new Error("Unbekanntes Format des verschlüsselten Werts.");
  const d = createDecipheriv("aes-256-gcm", schluessel(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(daten, "base64url")), d.final()]).toString("utf8");
}

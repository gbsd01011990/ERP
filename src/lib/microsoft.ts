/**
 * Microsoft 365 über Microsoft Graph mit App-Berechtigung (Client-Credentials).
 *
 * Je Mandant eine App-Registrierung in Microsoft Entra ID mit den Anwendungsberechtigungen
 * Mail.ReadWrite und Mail.Send (Administratorzustimmung). Werte aus der Firma (Einstellungen →
 * Postfächer) oder ersatzweise aus MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET.
 * Für Tests lassen sich MS_LOGIN_URL und MS_GRAPH_URL auf einen nachgebauten Server umbiegen.
 */

import { createHash } from "node:crypto";

const loginBasis = () => (process.env.MS_LOGIN_URL ?? "https://login.microsoftonline.com").replace(/\/$/, "");
const graphBasis = () => (process.env.MS_GRAPH_URL ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");

export type MsZugang = { tenantId: string; clientId: string; clientSecret: string };

export class MicrosoftFehler extends Error {
  constructor(meldung: string, public status = 0) {
    super(meldung);
  }
}

// App-Tokens gelten ca. 1 Stunde; je Tenant+App im Speicher halten
const cache = new Map<string, { token: string; bis: number }>();

/** ohneCache: immer frisch bei Microsoft anmelden (beim Prüfen neuer Zugangsdaten). */
export async function appToken(z: MsZugang, ohneCache = false) {
  // Schlüssel enthält einen Hash des Secrets: ein geändertes Secret wird nie mit einem alten Token beantwortet
  const key = `${z.tenantId}|${z.clientId}|${createHash("sha256").update(z.clientSecret).digest("hex").slice(0, 16)}`;
  const c = cache.get(key);
  if (!ohneCache && c && c.bis > Date.now()) return c.token;
  const res = await fetch(`${loginBasis()}/${encodeURIComponent(z.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: z.clientId, client_secret: z.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    throw new MicrosoftFehler(`Anmeldung bei Microsoft fehlgeschlagen: ${j.error_description?.split("\r\n")[0] ?? j.error ?? res.status}`, res.status);
  }
  cache.set(key, { token: j.access_token, bis: Date.now() + ((j.expires_in ?? 3600) - 300) * 1000 });
  return j.access_token;
}

async function anfrage<T>(token: string, url: string, init: RequestInit = {}): Promise<T | null> {
  for (let versuch = 0; ; versuch++) {
    const res = await fetch(url.startsWith("http") ? url : `${graphBasis()}${url}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    if (res.status === 429 && versuch < 3) {
      // Drosselung durch Microsoft: Retry-After abwarten
      await new Promise((r) => setTimeout(r, Math.min(Number(res.headers.get("retry-after") ?? 5), 30) * 1000));
      continue;
    }
    if (res.status === 202 || res.status === 204) return null;
    const j = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (!res.ok) {
      const code = j.error?.code ?? String(res.status);
      const hilfe =
        code === "ErrorAccessDenied" || res.status === 403
          ? " – die App hat keinen Zugriff auf dieses Postfach (Berechtigung oder Zugriffsrichtlinie in Microsoft 365 prüfen)."
          : code === "ErrorInvalidUser" || code === "MailboxNotEnabledForRESTAPI" || res.status === 404
            ? " – Postfach nicht gefunden. Adresse prüfen."
            : "";
      throw new MicrosoftFehler(`Microsoft: ${j.error?.message ?? code}${hilfe}`, res.status);
    }
    return j;
  }
}

export const graph = async <T>(token: string, url: string, headers: Record<string, string> = {}) => (await anfrage<T>(token, url, { headers })) as T;
export const graphPost = <T = unknown>(token: string, pfad: string, body: unknown) => anfrage<T>(token, pfad, { method: "POST", body: JSON.stringify(body) });
export const graphPatch = <T = unknown>(token: string, pfad: string, body: unknown) => anfrage<T>(token, pfad, { method: "PATCH", body: JSON.stringify(body) });

export type GraphAdresse = { emailAddress?: { name?: string; address?: string } };
export type GraphNachricht = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  from?: GraphAdresse;
  toRecipients?: GraphAdresse[];
  ccRecipients?: GraphAdresse[];
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  webLink?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  "@removed"?: unknown;
};

export const NACHRICHT_FELDER =
  "id,internetMessageId,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,hasAttachments,webLink,receivedDateTime,sentDateTime,isRead,isDraft";

export const postfachPfad = (adresse: string) => `/users/${encodeURIComponent(adresse)}`;

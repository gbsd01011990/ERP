/**
 * Messenger-Adapter: eingehende Nachrichten in eine gemeinsame Form bringen,
 * Echtheit prüfen und Antworten senden. Ohne Datenbank, damit testbar.
 *
 * - Telegram Bot API: Webhook mit Kopf „X-Telegram-Bot-Api-Secret-Token“.
 * - WhatsApp Cloud API (Meta): Webhook mit „X-Hub-Signature-256: sha256=<HMAC(App-Secret, Body)>“,
 *   Einrichtung per GET mit hub.verify_token.
 * - SMS über Twilio: Formular-Webhook mit „X-Twilio-Signature“ = Base64(HMAC-SHA1(Auth-Token, URL + Parameter sortiert)).
 *
 * Basis-URLs lassen sich für Tests über Umgebungsvariablen umbiegen.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type KanalName = "TELEGRAM" | "WHATSAPP" | "SMS";

export type Eingang = {
  chat: string;        // Gesprächskennung beim Messenger (Chat-ID bzw. Rufnummer)
  absender: string;    // Rufnummer oder @Name
  name: string | null;
  text: string;
  nachrichtId: string;
  zeit: Date;
  telefon: string | null; // für die Kontaktsuche
};

export type Geheim = {
  telegram?: { token: string; webhookGeheimnis: string };
  whatsapp?: { zugriffstoken: string; appGeheimnis: string; verifyToken: string };
  sms?: { accountSid: string; authToken: string };
};

const gleich = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

// ------------------------------------------------------------------ Telegram

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number; date: number; text?: string; caption?: string;
    chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string; title?: string };
    from?: { first_name?: string; last_name?: string; username?: string };
    contact?: { phone_number: string; first_name?: string; last_name?: string };
    photo?: unknown[]; document?: { file_name?: string }; voice?: unknown; location?: { latitude: number; longitude: number };
  };
};

export function telegramPruefen(geheimnis: string | undefined, kopf: string | null) {
  return !!geheimnis && !!kopf && gleich(Buffer.from(geheimnis), Buffer.from(kopf));
}

export function telegramLesen(roh: unknown): Eingang[] {
  const m = (roh as TgUpdate).message;
  if (!m || m.chat.type !== "private") return [];
  const name = [m.from?.first_name ?? m.chat.first_name, m.from?.last_name ?? m.chat.last_name].filter(Boolean).join(" ") || null;
  const text = m.text ?? m.caption ?? (m.contact ? `Kontakt geteilt: ${m.contact.phone_number}`
    : m.photo ? "[Foto]" : m.document ? `[Datei ${m.document.file_name ?? ""}]`.replace(" ]", "]") : m.voice ? "[Sprachnachricht]"
    : m.location ? `[Standort ${m.location.latitude}, ${m.location.longitude}]` : "[Nachricht ohne Text]");
  return [{
    chat: String(m.chat.id), absender: m.chat.username ? `@${m.chat.username}` : `Telegram ${m.chat.id}`, name, text,
    nachrichtId: String(m.message_id), zeit: new Date(m.date * 1000), telefon: m.contact?.phone_number ?? null,
  }];
}

export async function telegramSenden(g: NonNullable<Geheim["telegram"]>, chat: string, text: string) {
  const basis = process.env.TELEGRAM_API_URL ?? "https://api.telegram.org";
  const r = await fetch(`${basis}/bot${g.token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text }),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id: number } };
  if (!r.ok || !j.ok) throw new Error(`Telegram: ${j.description ?? r.status}`);
  return String(j.result?.message_id ?? "");
}

export async function telegramWebhookSetzen(g: NonNullable<Geheim["telegram"]>, url: string) {
  const basis = process.env.TELEGRAM_API_URL ?? "https://api.telegram.org";
  const r = await fetch(`${basis}/bot${g.token}/setWebhook`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: g.webhookGeheimnis, allowed_updates: ["message"] }),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!r.ok || !j.ok) throw new Error(`Telegram: ${j.description ?? r.status}`);
}

// ------------------------------------------------------------------ WhatsApp

type WaPayload = {
  object?: string;
  entry?: { changes?: { field?: string; value?: {
    metadata?: { phone_number_id?: string };
    contacts?: { wa_id: string; profile?: { name?: string } }[];
    messages?: { id: string; from: string; timestamp: string; type: string; text?: { body: string }; image?: { caption?: string }; document?: { filename?: string; caption?: string }; location?: { latitude: number; longitude: number }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } }[];
  } }[] }[];
};

export function whatsappPruefen(appGeheimnis: string | undefined, kopf: string | null, body: string) {
  if (!appGeheimnis || !kopf?.startsWith("sha256=")) return false;
  const soll = createHmac("sha256", appGeheimnis).update(body, "utf8").digest();
  return gleich(soll, Buffer.from(kopf.slice(7), "hex"));
}

/** Nur Nachrichten an die eigene Phone-Number-ID; Status-Meldungen (zugestellt, gelesen) werden übergangen. */
export function whatsappLesen(roh: unknown, phoneNumberId: string | null): Eingang[] {
  const raus: Eingang[] = [];
  for (const e of (roh as WaPayload).entry ?? []) {
    for (const c of e.changes ?? []) {
      const v = c.value;
      if (!v?.messages || (phoneNumberId && v.metadata?.phone_number_id !== phoneNumberId)) continue;
      for (const m of v.messages) {
        const name = v.contacts?.find((k) => k.wa_id === m.from)?.profile?.name ?? null;
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          ?? (m.type === "image" ? `[Foto]${m.image?.caption ? ` ${m.image.caption}` : ""}`
          : m.type === "document" ? `[Datei ${m.document?.filename ?? ""}]`.replace(" ]", "]")
          : m.type === "audio" ? "[Sprachnachricht]" : m.type === "location" && m.location ? `[Standort ${m.location.latitude}, ${m.location.longitude}]`
          : `[${m.type}]`);
        raus.push({ chat: m.from, absender: `+${m.from}`, name, text, nachrichtId: m.id, zeit: new Date(Number(m.timestamp) * 1000), telefon: `+${m.from}` });
      }
    }
  }
  return raus;
}

export async function whatsappSenden(g: NonNullable<Geheim["whatsapp"]>, phoneNumberId: string, an: string, text: string) {
  const basis = process.env.WHATSAPP_API_URL ?? "https://graph.facebook.com/v21.0";
  const r = await fetch(`${basis}/${phoneNumberId}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${g.zugriffstoken}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: an.replace(/\D/g, ""), type: "text", text: { body: text } }),
  });
  const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(`WhatsApp: ${j.error?.message ?? r.status}`);
  return j.messages?.[0]?.id ?? "";
}

/** WhatsApp erlaubt freie Antworten nur bis 24 Stunden nach der letzten Kundennachricht. */
export const whatsappFensterOffen = (letzteKundennachricht: Date | null, jetzt = new Date()) =>
  !!letzteKundennachricht && jetzt.getTime() - letzteKundennachricht.getTime() < 24 * 3600 * 1000;

// ------------------------------------------------------------------ SMS (Twilio)

export function twilioPruefen(authToken: string | undefined, kopf: string | null, url: string, felder: Record<string, string>) {
  if (!authToken || !kopf) return false;
  const daten = url + Object.keys(felder).sort().map((k) => k + felder[k]).join("");
  const soll = createHmac("sha1", authToken).update(daten, "utf8").digest();
  return gleich(soll, Buffer.from(kopf, "base64"));
}

export function smsLesen(felder: Record<string, string>): Eingang[] {
  if (!felder.From || !felder.MessageSid) return [];
  const medien = Number(felder.NumMedia ?? 0);
  const text = (felder.Body ?? "").trim() || (medien ? "[Bild/MMS]" : "[leere SMS]");
  return [{ chat: felder.From, absender: felder.From, name: null, text, nachrichtId: felder.MessageSid, zeit: new Date(), telefon: felder.From }];
}

export async function smsSenden(g: NonNullable<Geheim["sms"]>, von: string, an: string, text: string) {
  const basis = process.env.TWILIO_API_URL ?? "https://api.twilio.com";
  const r = await fetch(`${basis}/2010-04-01/Accounts/${g.accountSid}/Messages.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${g.accountSid}:${g.authToken}`).toString("base64")}` },
    body: new URLSearchParams({ From: von, To: an, Body: text }).toString(),
  });
  const j = (await r.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!r.ok) throw new Error(`Twilio: ${j.message ?? r.status}`);
  return j.sid ?? "";
}

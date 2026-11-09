/** Öffentliche Adresse einer Anfrage (hinter Caddy steht in req.url die interne Adresse). Für Twilio-Signaturen nötig. */
export function oeffentlicheUrl(req: Request) {
  const intern = new URL(req.url);
  if (process.env.ERP_URL) return process.env.ERP_URL.replace(/\/$/, "") + intern.pathname + intern.search;
  const proto = req.headers.get("x-forwarded-proto") ?? intern.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? intern.host;
  return `${proto}://${host}${intern.pathname}${intern.search}`;
}

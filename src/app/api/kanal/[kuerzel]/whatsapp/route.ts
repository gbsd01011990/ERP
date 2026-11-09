import { NextResponse } from "next/server";
import { zugangLaden, geheimLesen, eingangVerarbeiten } from "@/lib/dienste/kanaele";
import { whatsappLesen, whatsappPruefen } from "@/lib/kanaele/adapter";

/** Einrichtung bei Meta: GET mit hub.mode=subscribe, hub.verify_token, hub.challenge. */
export async function GET(req: Request, { params }: { params: Promise<{ kuerzel: string }> }) {
  const u = new URL(req.url);
  const z = await zugangLaden((await params).kuerzel, "WHATSAPP");
  const soll = z ? geheimLesen(z).whatsapp?.verifyToken : undefined;
  if (u.searchParams.get("hub.mode") === "subscribe" && soll && u.searchParams.get("hub.verify_token") === soll) {
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Nicht berechtigt", { status: 403 });
}

/** Eingehende WhatsApp-Nachrichten: POST /api/kanal/<kuerzel>/whatsapp, signiert mit dem App-Geheimnis. */
export async function POST(req: Request, { params }: { params: Promise<{ kuerzel: string }> }) {
  const z = await zugangLaden((await params).kuerzel, "WHATSAPP");
  const body = await req.text();
  if (!z || !whatsappPruefen(geheimLesen(z).whatsapp?.appGeheimnis, req.headers.get("x-hub-signature-256"), body)) {
    return NextResponse.json({ fehler: "Signatur ungültig" }, { status: 401 });
  }
  if (z.aktiv) await eingangVerarbeiten(z, whatsappLesen(JSON.parse(body), z.kennung));
  return NextResponse.json({ ok: true });
}

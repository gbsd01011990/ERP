import { NextResponse } from "next/server";
import { zugangLaden, geheimLesen, eingangVerarbeiten } from "@/lib/dienste/kanaele";
import { telegramLesen, telegramPruefen } from "@/lib/kanaele/adapter";

/** Telegram-Webhook je Firma: POST /api/kanal/<kuerzel>/telegram */
export async function POST(req: Request, { params }: { params: Promise<{ kuerzel: string }> }) {
  const z = await zugangLaden((await params).kuerzel, "TELEGRAM");
  if (!z || !telegramPruefen(geheimLesen(z).telegram?.webhookGeheimnis, req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ fehler: "Nicht berechtigt" }, { status: 401 });
  }
  if (!z.aktiv) return NextResponse.json({ ok: true, ignoriert: "ausgeschaltet" });
  await eingangVerarbeiten(z, telegramLesen(await req.json()));
  return NextResponse.json({ ok: true });
}

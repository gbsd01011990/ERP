import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { anrufBeendet, signaturGueltig } from "@/lib/dienste/telefonagent";

/**
 * Nach jedem Gespräch: POST /api/agent/<kuerzel>/anruf-ende (ElevenLabs „post_call_transcription“).
 * Echtheit über die HMAC-Signatur im Kopf „ElevenLabs-Signature“.
 */
export async function POST(req: Request, { params }: { params: Promise<{ kuerzel: string }> }) {
  const { kuerzel } = await params;
  const f = await db.firma.findUnique({ where: { kuerzel: kuerzel.toUpperCase() } });
  const a = f ? await db.telefonAgent.findUnique({ where: { firmaId: f.id }, include: { firma: true } }) : null;
  const body = await req.text();
  if (!a || !signaturGueltig(a.webhookGeheimnis, req.headers.get("elevenlabs-signature"), body)) {
    return NextResponse.json({ fehler: "Signatur ungültig" }, { status: 401 });
  }
  const daten = JSON.parse(body) as { type?: string };
  if (daten.type && daten.type !== "post_call_transcription") return NextResponse.json({ ok: true, ignoriert: daten.type });
  const g = await anrufBeendet(a, daten);
  return NextResponse.json({ ok: true, gespraech: g.id });
}

import { NextResponse } from "next/server";
import { zugangLaden, geheimLesen, eingangVerarbeiten } from "@/lib/dienste/kanaele";
import { smsLesen, twilioPruefen } from "@/lib/kanaele/adapter";
import { oeffentlicheUrl } from "@/lib/kanaele/url";

const leer = () => new NextResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>", { headers: { "Content-Type": "text/xml" } });

/** Eingehende SMS über Twilio: POST /api/kanal/<kuerzel>/sms (Formular), signiert mit dem Auth-Token. */
export async function POST(req: Request, { params }: { params: Promise<{ kuerzel: string }> }) {
  const z = await zugangLaden((await params).kuerzel, "SMS");
  const felder = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  if (!z || !twilioPruefen(geheimLesen(z).sms?.authToken, req.headers.get("x-twilio-signature"), oeffentlicheUrl(req), felder)) {
    return new NextResponse("Signatur ungültig", { status: 401 });
  }
  if (z.aktiv) await eingangVerarbeiten(z, smsLesen(felder));
  return leer();
}

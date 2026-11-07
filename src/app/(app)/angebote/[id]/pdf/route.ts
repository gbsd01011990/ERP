import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { ladeAngebot } from "@/lib/angebot";
import { belegDaten, pdfErzeugen } from "@/lib/pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await aktuellerBenutzer();
  if (!b) return new NextResponse("Nicht angemeldet", { status: 401 });
  const a = await ladeAngebot((await params).id, b);
  if (!a) return new NextResponse("Nicht gefunden", { status: 404 });
  const daten = belegDaten(a);
  const pdf = await pdfErzeugen(daten);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${daten.dokumentart}_${daten.belegnummer}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

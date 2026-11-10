import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { bestellungLaden } from "@/lib/dienste/einkauf";
import { bestellungPdf } from "@/lib/einkauf/pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await aktuellerBenutzer();
  if (!b) return new NextResponse("Nicht angemeldet", { status: 401 });
  try {
    const x = await bestellungLaden(b, (await params).id);
    const pdf = await bestellungPdf(x);
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Bestellung_${x.nummer ?? "Entwurf"}.pdf"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof FachFehler) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}

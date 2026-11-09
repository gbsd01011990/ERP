import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { db } from "@/lib/db";

/** Gespeicherte XRechnung (oder mit ?zugferd=1 das eingebettete EN-16931-XML) herunterladen. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await aktuellerBenutzer();
  if (!b || b.rolle === "KOLONNE") return new NextResponse("Keine Berechtigung", { status: 403 });
  const r = await db.rechnung.findUnique({ where: { id: (await params).id }, select: { firmaId: true, nummer: true, xml: true, xrechnung: true } });
  if (!r || r.firmaId !== b.mandant.id) return new NextResponse("Nicht gefunden", { status: 404 });
  const zugferd = new URL(req.url).searchParams.get("zugferd") === "1";
  const xml = zugferd ? r.xml : r.xrechnung;
  if (!xml) return new NextResponse("Für diese Rechnung gibt es keine E-Rechnung. Den Grund zeigt die Rechnungsseite.", { status: 404 });
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${zugferd ? "factur-x" : "XRechnung"}_${r.nummer}.xml"`, "Cache-Control": "no-store" },
  });
}

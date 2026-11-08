import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { lvExportieren, EXPORT_PHASEN, type ExportPhase } from "@/lib/dienste/gaeb";
import { FachFehler } from "@/lib/dienste/fehler";
import { GaebFehler } from "@/lib/gaeb";

/** GAEB-Datei zum Angebot herunterladen: /angebote/<id>/gaeb?phase=X84 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await aktuellerBenutzer();
  if (!b) return new NextResponse("Nicht angemeldet", { status: 401 });
  if (b.rolle === "KOLONNE") return new NextResponse("Keine Berechtigung", { status: 403 });
  const phase = (new URL(req.url).searchParams.get("phase") ?? "X84").toUpperCase();
  if (!(phase in EXPORT_PHASEN)) return new NextResponse("Unbekannte Phase", { status: 400 });
  try {
    const r = await lvExportieren(b, (await params).id, phase as ExportPhase);
    return new NextResponse(new Uint8Array(r.daten), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${r.name}"`,
        "X-GAEB-Hinweise": encodeURIComponent(r.warnungen.join(" | ")).slice(0, 4000),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof FachFehler || e instanceof GaebFehler) return new NextResponse(e.message, { status: 422 });
    throw e;
  }
}

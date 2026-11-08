import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { rechnungLaden, gespeichertesPdf } from "@/lib/dienste/rechnungen";
import { rechnungPdf, mengennachweisPdf, rechnungsName } from "@/lib/faktura/pdf";

/**
 * Festgeschriebene Rechnung: das beim Festschreiben gespeicherte PDF (GoBD, unverändert).
 * Entwurf: Vorschau, frisch erzeugt. ?mengennachweis=1 liefert den Mengennachweis.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await aktuellerBenutzer();
  if (!b) return new NextResponse("Nicht angemeldet", { status: 401 });
  if (b.rolle === "KOLONNE") return new NextResponse("Keine Berechtigung", { status: 403 });
  const id = (await params).id;
  const mengen = new URL(req.url).searchParams.get("mengennachweis") === "1";
  try {
    const gespeichert = await gespeichertesPdf(b, id);
    let daten: Buffer | Uint8Array;
    let name: string;
    if (!mengen && gespeichert.pdf) {
      daten = gespeichert.pdf;
      name = rechnungsName(gespeichert);
    } else {
      const r = await rechnungLaden(b, id);
      daten = mengen ? await mengennachweisPdf(r) : await rechnungPdf(r);
      name = mengen ? `Mengennachweis_${r.nummer ?? "Entwurf"}.pdf` : rechnungsName(r);
    }
    return new NextResponse(new Uint8Array(daten), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof FachFehler) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}

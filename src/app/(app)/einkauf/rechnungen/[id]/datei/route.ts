import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { eingangDatei } from "@/lib/dienste/einkauf";

/** Originalbeleg (PDF oder XML) unverändert ausliefern. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await aktuellerBenutzer();
  if (!b || b.rolle === "KOLONNE") return new NextResponse("Keine Berechtigung", { status: 403 });
  try {
    const r = await eingangDatei(b, (await params).id);
    const pdf = Buffer.from(r.datei).subarray(0, 5).toString() === "%PDF-";
    return new NextResponse(new Uint8Array(r.datei), {
      headers: {
        "Content-Type": pdf ? "application/pdf" : "application/xml; charset=utf-8",
        "Content-Disposition": `${pdf ? "inline" : "attachment"}; filename="${r.dateiName.replace(/["\\]/g, "_")}"`,
        // Fremde Dateien: XML nie im Browser ausführen lassen; PDFs zeigt der eingebaute Betrachter
        ...(pdf ? {} : { "Content-Security-Policy": "sandbox" }), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof FachFehler) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}

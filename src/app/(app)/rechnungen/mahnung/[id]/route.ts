import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { mahnungPdf } from "@/lib/dienste/zahlungen";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await aktuellerBenutzer();
  if (!b || b.rolle === "KOLONNE") return new NextResponse("Keine Berechtigung", { status: 403 });
  try {
    const m = await mahnungPdf(b, (await params).id);
    return new NextResponse(new Uint8Array(m.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${m.name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof FachFehler) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}

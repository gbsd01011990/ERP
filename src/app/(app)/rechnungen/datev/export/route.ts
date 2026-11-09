import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { datevExport } from "@/lib/dienste/zahlungen";

/** ZIP für die Kanzlei: /rechnungen/datev/export?von=JJJJ-MM-TT&bis=JJJJ-MM-TT */
export async function GET(req: Request) {
  const b = await aktuellerBenutzer();
  if (!b || b.rolle === "KOLONNE") return new NextResponse("Keine Berechtigung", { status: 403 });
  const u = new URL(req.url);
  try {
    const r = await datevExport(b, u.searchParams.get("von") ?? "", u.searchParams.get("bis") ?? "");
    return new NextResponse(new Uint8Array(r.zip), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${r.name}"`, "Cache-Control": "no-store", "X-Anzahl": `${r.rechnungen} Rechnungen, ${r.zahlungen} Zahlungen` },
    });
  } catch (e) {
    if (e instanceof FachFehler) return new NextResponse(e.message, { status: 422 });
    throw e;
  }
}

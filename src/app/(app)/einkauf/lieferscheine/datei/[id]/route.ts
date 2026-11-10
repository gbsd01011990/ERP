import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { lieferscheinDatei } from "@/lib/dienste/lieferscheine";

/** Foto oder PDF eines Lieferscheins. Der Typ stammt aus der Inhaltsprüfung beim Hochladen. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await aktuellerBenutzer();
  if (!b) return new NextResponse("Nicht angemeldet", { status: 401 });
  try {
    const d = await lieferscheinDatei(b, (await params).id);
    const anzeigen = d.typ !== "image/heic";
    return new NextResponse(new Uint8Array(d.daten), {
      headers: {
        "Content-Type": d.typ, "Content-Disposition": `${anzeigen ? "inline" : "attachment"}; filename="${d.name.replace(/["\\]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    if (e instanceof FachFehler) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}

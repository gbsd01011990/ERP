import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { FachFehler } from "@/lib/dienste/fehler";
import { agentAusAnfrage, werkzeugAusfuehren, W, type WerkzeugName } from "@/lib/dienste/telefonagent";

/**
 * Werkzeug-Aufruf der Sprachplattform: POST /api/agent/<kuerzel>/werkzeug/<name>
 * Authorization: Bearer <Werkzeug-Schlüssel der Firma>. Antwort immer JSON; fachliche
 * Fehler als { fehler } mit Status 200, damit der Agent sie dem Anrufer erklären kann.
 */
export async function POST(req: Request, { params }: { params: Promise<{ kuerzel: string; name: string }> }) {
  const { kuerzel, name } = await params;
  const a = await agentAusAnfrage(kuerzel, req.headers.get("authorization"));
  if (!a) return NextResponse.json({ fehler: "Nicht berechtigt" }, { status: 401 });
  if (!a.aktiv) return NextResponse.json({ fehler: "Der Telefonagent ist ausgeschaltet. Bitte einen Rückruf zusagen." });
  if (!(name in W)) return NextResponse.json({ fehler: `Unbekanntes Werkzeug ${name}` }, { status: 404 });
  let body: unknown = {};
  try { body = await req.json(); } catch { /* leerer Körper */ }
  try {
    return NextResponse.json(await werkzeugAusfuehren(a, name as WerkzeugName, body));
  } catch (e) {
    if (e instanceof FachFehler) return NextResponse.json({ fehler: e.message });
    if (e instanceof ZodError) return NextResponse.json({ fehler: `Angaben fehlen oder sind ungültig: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` });
    console.error("Agent-Werkzeug", name, e);
    return NextResponse.json({ fehler: "Technischer Fehler. Bitte einen Rückruf anlegen oder zusagen." }, { status: 500 });
  }
}

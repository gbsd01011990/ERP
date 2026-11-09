"use server";
import { revalidatePath } from "next/cache";
import { benutzerPflicht } from "@/lib/auth";
import { db } from "@/lib/db";
import { FachFehler } from "@/lib/dienste/fehler";
import { antworten } from "@/lib/dienste/kanaele";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;

async function laden(id: string) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const g = await db.gespraech.findUnique({ where: { id } });
  if (!g || g.firmaId !== b.mandant.id) throw new FachFehler("Gespräch nicht gefunden.");
  return { b, g };
}

export async function erledigtAktion(f: FormData) {
  const { g } = await laden(String(f.get("id")));
  await db.gespraech.update({ where: { id: g.id }, data: { status: g.status === "OFFEN" ? "ERLEDIGT" : "OFFEN" } });
  revalidatePath("/anrufe");
  revalidatePath(`/anrufe/${g.id}`);
}

/** Gespräch einem Projekt (und damit dessen Kunden) zuordnen, über die Projektnummer. */
export async function zuordnenAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  try {
    const { b, g } = await laden(String(f.get("id")));
    const nr = String(f.get("projektnummer") ?? "").trim();
    const p = await db.projekt.findFirst({ where: { firmaId: b.mandant.id, nummer: nr } });
    if (!p) throw new FachFehler(`Projekt ${nr} gibt es in diesem Mandanten nicht.`);
    await db.gespraech.update({ where: { id: g.id }, data: { projektId: p.id, kontaktId: p.kontaktId } });
    await db.logbuchEintrag.create({ data: { projektId: p.id, benutzerId: b.id, art: "ANRUF", text: `Anruf zugeordnet: ${g.zusammenfassung ?? g.anliegen ?? g.absender}` } });
    revalidatePath(`/anrufe/${g.id}`);
    return { ok: `Zugeordnet zu ${p.nummer} ${p.titel}.`, zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    throw e;
  }
}

export async function antwortAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const { b, g } = await laden(String(f.get("id")));
  try {
    await antworten(b, g.id, String(f.get("text") ?? ""));
    revalidatePath(`/anrufe/${g.id}`);
    return { ok: "Gesendet.", zeit: Date.now() };
  } catch (e) {
    if (e instanceof FachFehler) return { fehler: e.message, zeit: Date.now() };
    if (e instanceof Error) return { fehler: `Senden fehlgeschlagen: ${e.message}`, zeit: Date.now() };
    throw e;
  }
}

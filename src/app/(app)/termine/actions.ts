"use server";
import { revalidatePath } from "next/cache";
import { benutzerPflicht } from "@/lib/auth";
import { db } from "@/lib/db";
import { berlinZuUtc } from "@/lib/zeit";
import { text, zahl } from "@/lib/formular";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;
const ARTEN = ["BESICHTIGUNG", "RUECKRUF", "BERATUNG", "AUSFUEHRUNG", "SONSTIGES"] as const;

export async function terminAktion(_: unknown, f: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const tag = text(f, "tag"), uhr = text(f, "uhrzeit"), titel = text(f, "titel");
  if (!tag || !uhr || !titel) return { fehler: "Tag, Uhrzeit und Titel angeben.", zeit: Date.now() };
  const art = ARTEN.find((a) => a === f.get("art")) ?? "SONSTIGES";
  const beginn = berlinZuUtc(tag, uhr);
  const dauer = Math.max(15, Math.round(zahl(f, "dauer", 60)));
  const nr = text(f, "projektnummer");
  const projekt = nr ? await db.projekt.findFirst({ where: { firmaId: b.mandant.id, nummer: nr } }) : null;
  if (nr && !projekt) return { fehler: `Projekt ${nr} nicht gefunden.`, zeit: Date.now() };
  const zustaendigId = text(f, "zustaendigId");
  if (zustaendigId && !(await db.zugriff.findUnique({ where: { benutzerId_firmaId: { benutzerId: zustaendigId, firmaId: b.mandant.id } } }))) {
    return { fehler: "Zuständige Person gehört nicht zu diesem Mandanten.", zeit: Date.now() };
  }
  await db.termin.create({
    data: {
      firmaId: b.mandant.id, art, titel, beginn, ende: new Date(beginn.getTime() + dauer * 60000), ort: text(f, "ort"), notiz: text(f, "notiz"),
      projektId: projekt?.id ?? null, kontaktId: projekt?.kontaktId ?? null, zustaendigId: zustaendigId ?? b.id, quelle: "Büro",
    },
  });
  revalidatePath("/termine");
  return { ok: "Termin eingetragen. Der Telefonagent bietet diese Zeit nicht mehr an.", zeit: Date.now() };
}

export async function absagenAktion(f: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const t = await db.termin.findUnique({ where: { id: String(f.get("id")) } });
  if (!t || t.firmaId !== b.mandant.id) return;
  await db.termin.update({ where: { id: t.id }, data: { abgesagt: !t.abgesagt } });
  revalidatePath("/termine");
}

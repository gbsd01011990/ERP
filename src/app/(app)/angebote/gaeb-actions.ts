"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { GaebFehler } from "@/lib/gaeb";
import { lvImportieren, mengenImportieren, preisangebotImportieren } from "@/lib/dienste/gaeb";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;

async function datei(form: FormData) {
  const f = form.get("datei");
  if (!(f instanceof File) || f.size === 0) throw new FachFehler("Bitte eine GAEB-Datei auswählen.");
  return { name: f.name, daten: Buffer.from(await f.arrayBuffer()) };
}
const fehler = (e: unknown) => (e instanceof FachFehler || e instanceof GaebFehler ? e.message : null);

export async function lvImportAktion(_: unknown, form: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  let ziel = "";
  try {
    const { name, daten } = await datei(form);
    const r = await lvImportieren(b, String(form.get("projektId")), name, daten);
    ziel = `/angebote/${r.angebot.id}`;
  } catch (e) {
    const t = fehler(e);
    if (t) return { fehler: t, zeit: Date.now() };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(ziel);
}

export async function mengenImportAktion(_: unknown, form: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const angebotId = String(form.get("angebotId"));
  try {
    const { name, daten } = await datei(form);
    const r = await mengenImportieren(b, angebotId, name, daten);
    revalidatePath(`/angebote/${angebotId}`);
    return { ok: `${r.uebernommen} Mengen übernommen.${r.unbekannt.length ? ` Ohne passende Ordnungszahl: ${r.unbekannt.slice(0, 10).join(", ")}${r.unbekannt.length > 10 ? " …" : ""}` : ""}`, zeit: Date.now() };
  } catch (e) {
    const t = fehler(e);
    if (t) return { fehler: t, zeit: Date.now() };
    throw e;
  }
}

export async function preisangebotAktion(_: unknown, form: FormData): Promise<Ergebnis> {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  try {
    const { name, daten } = await datei(form);
    const r = await preisangebotImportieren(b, name, daten, form.get("uebernehmen") === "on");
    const treffer = r.positionen.filter((p) => p.artikelId);
    revalidatePath("/lager", "layout");
    const liste = r.positionen.slice(0, 15).map((p) => `${p.lieferantArtNr ?? p.artNr ?? "?"} ${p.kurztext ?? ""}: ${p.proEinheit?.toLocaleString("de-DE", { style: "currency", currency: "EUR" }) ?? "ohne Preis"}${p.artikel ? ` → ${p.artikel}` : ""}`);
    return {
      ok: `${r.phase}: ${r.positionen.length} Positionen, ${treffer.length} einem Lagerartikel zugeordnet${form.get("uebernehmen") === "on" ? ", EK übernommen" : ""}.\n${liste.join("\n")}`,
      zeit: Date.now(),
    };
  } catch (e) {
    const t = fehler(e);
    if (t) return { fehler: t, zeit: Date.now() };
    throw e;
  }
}

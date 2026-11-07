/**
 * Übernimmt Kontakte und Projekte aus HERO in das ERP.
 *
 *   HERO_API_TOKEN=... npm run import:hero -- --firma GBSD
 *
 * Mehrfach ausführbar: Kontakte werden über KontaktFremdId, Projekte über (firmaId, heroId) erkannt
 * und aktualisiert statt doppelt angelegt. Liest HERO nur, schreibt dort nichts.
 */
import { PrismaClient, type KontaktKategorie } from "@prisma/client";

const db = new PrismaClient();
const URL_ = process.env.HERO_API_URL ?? "https://login.hero-software.de/api/external/v7/graphql";
const TOKEN = process.env.HERO_API_TOKEN;
const SEITE = 100;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function hero<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HERO antwortet mit ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

async function alle<T>(feld: string, query: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += SEITE) {
    const d = await hero<Record<string, T[]>>(query, { first: SEITE, offset });
    const seite = d[feld] ?? [];
    out.push(...seite);
    if (seite.length < SEITE) return out;
  }
}

type HeroAdresse = { street?: string; zipcode?: string; city?: string; latitude?: number; longitude?: number } | null;
type HeroKontakt = {
  id: number; nr?: string; title?: string; first_name?: string; last_name?: string; company_name?: string;
  email?: string; phone_home?: string; phone_mobile?: string; url?: string; category?: string; leitweg_nr?: string;
  partner_notes?: string; is_deleted?: boolean; address: HeroAdresse;
};
type HeroProjekt = {
  id: number; project_nr?: string; name?: string; project_title?: string; volume?: number; partner_notes?: string;
  partner_source?: string; created?: string; is_deleted?: boolean; customer_id?: number;
  type?: { name?: string } | null; current_project_match_status?: { name?: string } | null; address: HeroAdresse;
};

const KONTAKTE = `query($first:Int,$offset:Int){ contacts(first:$first, offset:$offset){
  id nr title first_name last_name company_name email phone_home phone_mobile url category leitweg_nr partner_notes is_deleted
  address { street zipcode city latitude longitude } } }`;

const PROJEKTE = `query($first:Int,$offset:Int){ project_matches(first:$first, offset:$offset){
  id project_nr name project_title volume partner_notes partner_source created is_deleted customer_id
  type { name } current_project_match_status { name } address { street zipcode city latitude longitude } } }`;

const leer = (s?: string | null) => (s && s.trim() !== "" ? s.trim() : null);

function kategorie(k: HeroKontakt): KontaktKategorie {
  const c = (k.category ?? "").toLowerCase();
  if (c.includes("public") || c.includes("öffentl") || k.leitweg_nr) return "OEFFENTLICH";
  if (c.includes("company") || c.includes("business") || k.company_name) return "GEWERBE";
  return "PRIVAT";
}

async function main() {
  const kuerzel = arg("firma");
  if (!TOKEN) throw new Error("HERO_API_TOKEN fehlt.");
  if (!kuerzel) throw new Error("Bitte Firma angeben: --firma GBSD | RD | KUD");
  const firma = await db.firma.findUniqueOrThrow({ where: { kuerzel } });

  // ---- Kontakte ----
  const kontakte = await alle<HeroKontakt>("contacts", KONTAKTE);
  const kontaktMap = new Map<number, string>();
  let neuK = 0;
  for (const k of kontakte) {
    if (k.is_deleted) continue;
    const daten = {
      nummer: null as string | null,
      kategorie: kategorie(k),
      firmenname: leer(k.company_name),
      anrede: leer(k.title),
      vorname: leer(k.first_name),
      nachname: leer(k.last_name),
      email: leer(k.email),
      telefon: leer(k.phone_home),
      mobil: leer(k.phone_mobile),
      web: leer(k.url),
      leitwegId: leer(k.leitweg_nr),
      notiz: leer(k.partner_notes),
    };
    const fremd = await db.kontaktFremdId.findUnique({
      where: { firmaId_system_fremdId: { firmaId: firma.id, system: "HERO", fremdId: String(k.id) } },
    });
    let id = fremd?.kontaktId;
    if (id) {
      await db.kontakt.update({ where: { id }, data: { ...daten, nummer: undefined } });
    } else {
      const neu = await db.kontakt.create({
        data: {
          ...daten,
          nummer: null,
          fremdIds: { create: { firmaId: firma.id, system: "HERO", fremdId: String(k.id) } },
          adressen: k.address?.street || k.address?.city
            ? { create: { art: "HAUPT", strasse: leer(k.address.street), plz: leer(k.address.zipcode), ort: leer(k.address.city), lat: k.address.latitude ?? null, lng: k.address.longitude ?? null } }
            : undefined,
        },
      });
      id = neu.id;
      neuK++;
    }
    kontaktMap.set(k.id, id);
  }
  console.log(`Kontakte: ${kontakte.length} gelesen, ${neuK} neu.`);

  // ---- Projekte ----
  const projekte = await alle<HeroProjekt>("project_matches", PROJEKTE);
  const statusListe = await db.pipelineStatus.findMany({ where: { firmaId: firma.id } });
  const statusMap = new Map(statusListe.map((s) => [s.name, s]));
  let maxReihe = Math.max(0, ...statusListe.filter((s) => !s.abgeschlossen).map((s) => s.reihenfolge));
  const fallback = [...statusListe].sort((a, b) => a.reihenfolge - b.reihenfolge)[0];

  let neuP = 0, ohneKunde = 0;
  for (const p of projekte) {
    if (p.is_deleted) continue;
    const kontaktId = p.customer_id ? kontaktMap.get(p.customer_id) : undefined;
    if (!kontaktId) { ohneKunde++; continue; }

    // Status nach Namen zuordnen, fehlende HERO-Status ergänzen
    const sName = p.current_project_match_status?.name?.trim();
    let status = sName ? statusMap.get(sName) : fallback;
    if (!status && sName) {
      maxReihe += 1;
      status = await db.pipelineStatus.create({ data: { firmaId: firma.id, name: sName, reihenfolge: maxReihe } });
      statusMap.set(sName, status);
    }
    status ??= fallback;

    const tName = p.type?.name?.replace(/^\W+\s*/u, "").trim();
    const typ = tName
      ? await db.projektTyp.upsert({ where: { firmaId_name: { firmaId: firma.id, name: tName } }, update: {}, create: { firmaId: firma.id, name: tName } })
      : null;

    const daten = {
      titel: leer(p.project_title) ?? leer(p.name) ?? `HERO ${p.project_nr ?? p.id}`,
      beschreibung: leer(p.partner_notes),
      quelle: leer(p.partner_source),
      volumen: p.volume ?? null,
      statusId: status.id,
      typId: typ?.id ?? null,
      kontaktId,
      baustelleStrasse: leer(p.address?.street),
      baustellePlz: leer(p.address?.zipcode),
      baustelleOrt: leer(p.address?.city),
      lat: p.address?.latitude ?? null,
      lng: p.address?.longitude ?? null,
    };
    const vorhanden = await db.projekt.findUnique({ where: { firmaId_heroId: { firmaId: firma.id, heroId: p.id } } });
    if (vorhanden) {
      await db.projekt.update({ where: { id: vorhanden.id }, data: daten });
    } else {
      await db.projekt.create({
        data: {
          ...daten,
          firmaId: firma.id,
          heroId: p.id,
          nummer: p.project_nr ?? `HERO-${p.id}`,
          createdAt: p.created ? new Date(p.created) : undefined,
          logbuch: { create: { art: "SYSTEM", text: "Aus HERO übernommen" } },
        },
      });
      neuP++;
    }
  }
  console.log(`Projekte: ${projekte.length} gelesen, ${neuP} neu, ${ohneKunde} ohne zuordenbaren Kunden übersprungen.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());

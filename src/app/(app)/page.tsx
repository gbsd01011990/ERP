import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { firmenFilter } from "@/lib/firma";
import { euro, datum, datumZeit, kontaktName } from "@/lib/format";
import { n } from "@/lib/kalkulation";
import { pruefAmpel } from "@/lib/rechnung/geraete";
import { PRUEFART } from "@/lib/geraete-texte";
import { berlinTag, berlinZuUtc, tagPlus } from "@/lib/zeit";
import { AufgabenListe, aufgabeInclude } from "@/components/aufgaben-liste";
import { emailFilter } from "@/lib/dienste/mail";

export default async function Uebersicht() {
  const b = await benutzerPflicht();
  const { ids } = await firmenFilter(b);

  const in30Tagen = new Date(Date.now() + 30 * 864e5);
  const [firmen, offene, letzte, pruefungen, mindest] = await Promise.all([
    db.firma.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } }),
    db.projekt.findMany({
      where: { firmaId: { in: ids }, status: { abgeschlossen: false } },
      select: { firmaId: true, volumen: true, status: { select: { name: true, farbe: true, reihenfolge: true } } },
    }),
    db.logbuchEintrag.findMany({
      where: { projekt: { firmaId: { in: ids } }, projektId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { projekt: { select: { id: true, nummer: true, titel: true, kontakt: true } }, benutzer: { select: { name: true } } },
    }),
    db.geraetPruefung.findMany({
      where: { naechsteAm: { lte: in30Tagen }, geraet: { firmaId: { in: ids }, status: { not: "AUSGEMUSTERT" } } },
      include: { geraet: true },
      orderBy: { naechsteAm: "asc" },
      take: 20,
    }),
    db.artikel.findMany({ where: { firmaId: { in: ids }, aktiv: true, mindestbestand: { not: null } }, include: { bestaende: true } }),
  ]);
  const bisMorgen = berlinZuUtc(tagPlus(berlinTag(new Date()), 1));
  const [meineAufgaben, offeneMails] = await Promise.all([
    db.aufgabe.findMany({
      where: { firmaId: b.mandant.id, zustaendigId: b.id, erledigtAm: null, OR: [{ faelligAm: { lt: bisMorgen } }, { faelligAm: null }] },
      include: aufgabeInclude, orderBy: [{ faelligAm: { sort: "asc", nulls: "last" } }], take: 20,
    }),
    db.email.count({ where: { AND: [await emailFilter(b), { richtung: "EINGANG", kontaktId: null, projektId: null, ignoriert: false }] } }),
  ]);
  const knapp = mindest
    .map((a) => ({ a, gesamt: a.bestaende.reduce((s, x) => s + n(x.menge), 0) }))
    .filter((x) => x.gesamt < n(x.a.mindestbestand));

  // Pipeline: Anzahl und Volumen je Status (über die gewählten Firmen summiert)
  const proStatus = new Map<string, { farbe: string; reihenfolge: number; anzahl: number; summe: number }>();
  for (const p of offene) {
    const e = proStatus.get(p.status.name) ?? { farbe: p.status.farbe, reihenfolge: p.status.reihenfolge, anzahl: 0, summe: 0 };
    e.anzahl++;
    e.summe += Number(p.volumen ?? 0);
    proStatus.set(p.status.name, e);
  }
  const pipeline = [...proStatus.entries()].sort((a, b) => a[1].reihenfolge - b[1].reihenfolge);

  return (
    <div className="space-y-6">
      <h1 className="h1">Übersicht</h1>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {firmen.map((f) => {
          const eigene = offene.filter((p) => p.firmaId === f.id);
          return (
            <div key={f.id} className="karte border-l-4" style={{ borderLeftColor: f.farbe }}>
              <div className="text-sm text-slate-500">{f.name}</div>
              <div className="mt-1 text-2xl font-semibold">{eigene.length} offene Projekte</div>
              <div className="text-sm text-slate-600">Volumen {euro(eigene.reduce((s, p) => s + Number(p.volumen ?? 0), 0))}</div>
            </div>
          );
        })}
      </section>

      <section className="karte">
        <h2 className="mb-3 font-semibold">Pipeline</h2>
        {pipeline.length === 0 ? (
          <p className="text-sm text-slate-500">Noch keine offenen Projekte.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {pipeline.map(([name, e]) => (
              <Link key={name} href={`/projekte?status=${encodeURIComponent(name)}`} className="rounded-md border border-slate-200 p-3 hover:bg-slate-50">
                <div className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full" style={{ background: e.farbe }} />{name}</div>
                <div className="mt-1 text-lg font-semibold">{e.anzahl}</div>
                <div className="text-xs text-slate-500">{euro(e.summe)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="karte">
          <div className="mb-2 flex items-center"><h2 className="font-semibold">Meine Aufgaben: heute und überfällig</h2><Link href="/aufgaben" className="ml-auto text-sm text-marke">alle</Link></div>
          <AufgabenListe aufgaben={meineAufgaben} leer="Für heute ist nichts offen." />
        </div>
        <Link href="/posteingang" className="karte block hover:border-marke">
          <div className="text-sm text-slate-500">Posteingang</div>
          <div className="text-2xl font-semibold">{offeneMails}</div>
          <div className="text-sm text-slate-600">nicht zugeordnete E-Mail{offeneMails === 1 ? "" : "s"}</div>
        </Link>
      </section>

      {(pruefungen.length > 0 || knapp.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {pruefungen.length > 0 && (
            <div className="karte">
              <h2 className="mb-2 font-semibold">Prüfungen fällig</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {pruefungen.map((p) => (
                  <li key={p.id} className="flex gap-3 py-1.5">
                    <span className={`w-24 shrink-0 ${pruefAmpel(p.naechsteAm) === "ueberfaellig" ? "font-medium text-red-700" : "text-amber-700"}`}>{p.naechsteAm ? datum(p.naechsteAm) : ""}</span>
                    <Link href={`/geraete/${p.geraetId}`} className="flex-1 text-marke">{p.geraet.bezeichnung}</Link>
                    <span className="text-slate-500">{p.bezeichnung ?? PRUEFART[p.art]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {knapp.length > 0 && (
            <div className="karte">
              <h2 className="mb-2 font-semibold">Unter Mindestbestand</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {knapp.map(({ a, gesamt }) => (
                  <li key={a.id} className="flex gap-3 py-1.5">
                    <Link href={`/lager/artikel/${a.id}`} className="flex-1 text-marke">{a.bezeichnung}</Link>
                    <span className="text-red-700">{gesamt.toLocaleString("de-DE")} / {n(a.mindestbestand).toLocaleString("de-DE")} {a.einheit}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="karte">
        <h2 className="mb-3 font-semibold">Letzte Aktivitäten</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {letzte.filter((l) => l.projekt).map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-3 py-2">
              <span className="w-28 shrink-0 text-slate-400">{datumZeit(l.createdAt)}</span>
              <Link href={`/projekte/${l.projekt!.id}`} className="font-medium text-marke">{l.projekt!.nummer}</Link>
              <span className="text-slate-500">{kontaktName(l.projekt!.kontakt)}</span>
              <span className="basis-full sm:basis-auto">{l.text}</span>
            </li>
          ))}
          {letzte.length === 0 && <li className="py-2 text-slate-500">Noch keine Einträge.</li>}
        </ul>
      </section>
    </div>
  );
}

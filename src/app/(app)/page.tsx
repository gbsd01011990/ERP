import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { firmenFilter } from "@/lib/firma";
import { euro, datumZeit, kontaktName } from "@/lib/format";

export default async function Uebersicht() {
  const b = await benutzerPflicht();
  const { ids } = await firmenFilter(b);

  const [firmen, offene, letzte] = await Promise.all([
    db.firma.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } }),
    db.projekt.findMany({
      where: { firmaId: { in: ids }, status: { abgeschlossen: false } },
      select: { firmaId: true, volumen: true, status: { select: { name: true, farbe: true, reihenfolge: true } } },
    }),
    db.logbuchEintrag.findMany({
      where: { projekt: { firmaId: { in: ids } } },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { projekt: { select: { id: true, nummer: true, titel: true, kontakt: true } }, benutzer: { select: { name: true } } },
    }),
  ]);

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

      <section className="karte">
        <h2 className="mb-3 font-semibold">Letzte Aktivitäten</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {letzte.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-3 py-2">
              <span className="w-28 shrink-0 text-slate-400">{datumZeit(l.createdAt)}</span>
              <Link href={`/projekte/${l.projekt.id}`} className="font-medium text-marke">{l.projekt.nummer}</Link>
              <span className="text-slate-500">{kontaktName(l.projekt.kontakt)}</span>
              <span className="basis-full sm:basis-auto">{l.text}</span>
            </li>
          ))}
          {letzte.length === 0 && <li className="py-2 text-slate-500">Noch keine Einträge.</li>}
        </ul>
      </section>
    </div>
  );
}

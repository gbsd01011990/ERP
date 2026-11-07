import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { firmenFilter } from "@/lib/firma";
import { euro, kontaktName } from "@/lib/format";
import type { Prisma } from "@prisma/client";

type Props = { searchParams: Promise<{ q?: string; status?: string; ansicht?: string; erledigt?: string }> };

export default async function Projekte({ searchParams }: Props) {
  const b = await benutzerPflicht();
  const { ids, aktiv } = await firmenFilter(b);
  const { q, status, ansicht = "liste", erledigt } = await searchParams;

  const where: Prisma.ProjektWhereInput = {
    firmaId: { in: ids },
    ...(status ? { status: { name: status } } : erledigt ? {} : { status: { abgeschlossen: false } }),
    ...(q
      ? {
          OR: [
            { nummer: { contains: q, mode: "insensitive" } },
            { titel: { contains: q, mode: "insensitive" } },
            { baustelleOrt: { contains: q, mode: "insensitive" } },
            { baustelleStrasse: { contains: q, mode: "insensitive" } },
            { kontakt: { OR: [{ nachname: { contains: q, mode: "insensitive" } }, { firmenname: { contains: q, mode: "insensitive" } }] } },
          ],
        }
      : {}),
  };

  const projekte = await db.projekt.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: { kontakt: true, status: true, firma: { select: { kuerzel: true, farbe: true } }, typ: true },
  });

  const param = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, ansicht, erledigt, ...p })) if (v) s.set(k, v);
    return `/projekte?${s}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Projekte</h1>
        <span className="text-sm text-slate-500">{projekte.length} Treffer</span>
        <div className="ml-auto flex gap-2">
          <Link href={param({ ansicht: "liste" })} className={ansicht === "liste" ? "btn" : "btn-hell"}>Liste</Link>
          <Link href={param({ ansicht: "board" })} className={ansicht === "board" ? "btn" : "btn-hell"}>Pipeline</Link>
          <Link href="/projekte/neu" className="btn">+ Projekt</Link>
        </div>
      </div>

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Suche: Nummer, Titel, Kunde, Ort" className="eingabe max-w-md" />
        <input type="hidden" name="ansicht" value={ansicht} />
        {status && <input type="hidden" name="status" value={status} />}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="erledigt" value="1" defaultChecked={!!erledigt} /> auch abgeschlossene
        </label>
        <button className="btn-hell">Suchen</button>
        {status && <Link href={param({ status: undefined })} className="btn-hell">Status „{status}“ ✕</Link>}
      </form>

      {ansicht === "board" ? <Board projekte={projekte} firmenIds={aktiv === "alle" ? ids : [aktiv]} /> : (
        <div className="karte overflow-x-auto p-0">
          <table className="tabelle">
            <thead>
              <tr><th>Nr.</th><th>Titel</th><th>Kunde</th><th>Ort</th><th>Status</th><th className="text-right">Volumen</th></tr>
            </thead>
            <tbody>
              {projekte.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: p.firma.farbe }} title={p.firma.kuerzel} />
                    <Link href={`/projekte/${p.id}`} className="font-medium text-marke">{p.nummer}</Link>
                  </td>
                  <td><Link href={`/projekte/${p.id}`}>{p.titel}</Link></td>
                  <td>{kontaktName(p.kontakt)}</td>
                  <td>{p.baustelleOrt ?? "–"}</td>
                  <td><span className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: p.status.farbe }}>{p.status.name}</span></td>
                  <td className="text-right">{euro(p.volumen)}</td>
                </tr>
              ))}
              {projekte.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">Keine Projekte gefunden.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type BoardProjekt = Prisma.ProjektGetPayload<{ include: { kontakt: true; status: true; firma: { select: { kuerzel: true; farbe: true } }; typ: true } }>;

async function Board({ projekte, firmenIds }: { projekte: BoardProjekt[]; firmenIds: string[] }) {
  // Spalten nach Statusnamen zusammenfassen, damit "Alle Firmen" eine gemeinsame Pipeline zeigt.
  const status = await db.pipelineStatus.findMany({ where: { firmaId: { in: firmenIds } }, orderBy: { reihenfolge: "asc" } });
  const spalten = [...new Map(status.map((s) => [s.name, s])).values()].filter((s) => !s.abgeschlossen || projekte.some((p) => p.status.name === s.name));

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {spalten.map((s) => {
        const karten = projekte.filter((p) => p.status.name === s.name);
        return (
          <div key={s.name} className="w-64 shrink-0 rounded-lg bg-slate-100 p-2">
            <div className="mb-2 flex items-center gap-2 px-1 text-sm font-medium">
              <span className="h-2 w-2 rounded-full" style={{ background: s.farbe }} />{s.name}
              <span className="ml-auto text-xs text-slate-500">{karten.length}</span>
            </div>
            <div className="space-y-2">
              {karten.map((p) => (
                <Link key={p.id} href={`/projekte/${p.id}`} className="block rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm hover:border-marke">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.firma.farbe }} />{p.nummer}
                  </div>
                  <div className="font-medium">{p.titel}</div>
                  <div className="text-xs text-slate-500">{kontaktName(p.kontakt)} · {euro(p.volumen)}</div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

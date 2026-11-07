import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { firmenFilter } from "@/lib/firma";
import { datum, euro, kontaktName } from "@/lib/format";

const STATUS = { ENTWURF: "Entwurf", VERSENDET: "Versendet", ANGENOMMEN: "Angenommen", ABGELEHNT: "Abgelehnt", ERSETZT: "Ersetzt" } as const;

export default async function Angebote({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const b = await benutzerPflicht();
  const { ids } = await firmenFilter(b);
  const { status } = await searchParams;
  const liste = await db.angebot.findMany({
    where: { firmaId: { in: ids }, ...(status && status in STATUS ? { status: status as keyof typeof STATUS } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 300,
    include: { projekt: { include: { kontakt: true } }, firma: true },
  });
  return (
    <div className="space-y-4">
      <h1 className="h1">Angebote und Auftragsbestätigungen</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/angebote" className={!status ? "btn" : "btn-hell"}>Alle</Link>
        {Object.entries(STATUS).map(([k, v]) => <Link key={k} href={`/angebote?status=${k}`} className={status === k ? "btn" : "btn-hell"}>{v}</Link>)}
      </div>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Nr.</th><th>Art</th><th>Kunde</th><th>Projekt</th><th>Datum</th><th>Status</th><th className="text-right">Netto</th></tr></thead>
          <tbody>
            {liste.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap"><Link href={`/angebote/${a.id}`} className="font-medium text-marke">{a.nummer}{a.version > 1 ? `-${a.version}` : ""}</Link></td>
                <td>{a.art === "ANGEBOT" ? "Angebot" : "AB"}</td>
                <td>{kontaktName(a.projekt.kontakt)}</td>
                <td><Link href={`/projekte/${a.projektId}`}>{a.projekt.nummer}</Link></td>
                <td>{datum(a.datum)}</td>
                <td>{STATUS[a.status]}</td>
                <td className="text-right">{euro(a.netto)}</td>
              </tr>
            ))}
            {liste.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Keine Belege.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

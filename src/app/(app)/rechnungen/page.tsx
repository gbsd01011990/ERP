import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { firmenFilter } from "@/lib/firma";
import { datum, euro, kontaktName } from "@/lib/format";
import { ART_TITEL, STATUS_TEXT } from "@/lib/faktura/texte";
import { RechnungenNav } from "@/components/rechnungen-nav";

const FILTER = { ENTWURF: "Entwürfe", FESTGESCHRIEBEN: "Festgeschrieben", STORNIERT: "Storniert" } as const;

export default async function Rechnungen({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const { ids } = await firmenFilter(b);
  const { status } = await searchParams;
  const liste = await db.rechnung.findMany({
    where: { firmaId: { in: ids }, ...(status && status in FILTER ? { status: status as keyof typeof FILTER } : {}) },
    orderBy: [{ datum: "desc" }, { createdAt: "desc" }],
    take: 300,
    omit: { pdf: true, berechnung: true },
    include: { projekt: { include: { kontakt: true } } },
  });
  const summe = liste.filter((r) => r.status === "FESTGESCHRIEBEN").reduce((s, r) => s + Number(r.brutto), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="h1">Rechnungen</h1>
        <span className="text-sm text-slate-500">Neue Rechnungen legst du im Projekt an.</span>
      </div>
      <RechnungenNav aktiv="/rechnungen" />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/rechnungen" className={!status ? "btn" : "btn-hell"}>Alle</Link>
        {Object.entries(FILTER).map(([k, v]) => <Link key={k} href={`/rechnungen?status=${k}`} className={status === k ? "btn" : "btn-hell"}>{v}</Link>)}
      </div>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Nr.</th><th>Art</th><th>Kunde</th><th>Projekt</th><th>Datum</th><th>Status</th><th className="text-right">Brutto</th><th className="text-right">Zahlbetrag</th></tr></thead>
          <tbody>
            {liste.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap"><Link href={`/rechnungen/${r.id}`} className="font-medium text-marke">{r.nummer ?? "Entwurf"}</Link></td>
                <td>{r.art === "ABSCHLAG" && r.abschlagNr ? `${r.abschlagNr}. Abschlag` : ART_TITEL[r.art]}</td>
                <td>{kontaktName(r.projekt.kontakt)}</td>
                <td><Link href={`/projekte/${r.projektId}`}>{r.projekt.nummer}</Link></td>
                <td>{datum(r.datum)}</td>
                <td>{STATUS_TEXT[r.status]}</td>
                <td className="text-right">{r.status === "ENTWURF" ? "–" : euro(r.brutto)}</td>
                <td className="text-right">{r.status === "ENTWURF" ? "–" : euro(r.zahlbetrag)}</td>
              </tr>
            ))}
            {liste.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-500">Keine Rechnungen.</td></tr>}
          </tbody>
          {summe !== 0 && <tfoot><tr><td colSpan={6} className="text-right text-slate-500">Summe festgeschrieben (Auswahl)</td><td className="text-right font-semibold">{euro(summe)}</td><td /></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

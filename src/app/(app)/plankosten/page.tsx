import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { planErgebnis } from "@/lib/rechnung/plankosten";
import { datum, euro } from "@/lib/format";
import { planAnlegenAktion } from "./actions";

export default async function Plankosten() {
  const b = await benutzerPflicht(["ADMIN"]);
  const plaene = await db.kostenplan.findMany({
    where: { firmaId: { in: firmenIds(b) } },
    include: { firma: true, zeilen: true },
    orderBy: [{ jahr: "desc" }, { firmaId: "asc" }],
  });
  const firmen = b.zugriffe.map((z) => z.firma);
  return (
    <div className="space-y-4">
      <h1 className="h1">Plankostenrechnung</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Ein Jahresplan je Firma: Personal, Gemeinkosten und Wagnis und Gewinn ergeben den Stundenverrechnungssatz und die Zuschläge auf Material und
        Fremdleistung. Mit „Sätze übernehmen“ rechnen neue Angebote mit diesen Werten. Bestehende Angebote behalten ihre Sätze.
      </p>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Jahr</th><th>Firma</th><th>Plan</th><th className="text-right">Stundensatz</th><th className="text-right">Material</th><th className="text-right">Planergebnis</th><th>Übernommen</th></tr></thead>
          <tbody>
            {plaene.map((p) => {
              const r = planErgebnis(p, p.zeilen);
              return (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td><Link href={`/plankosten/${p.id}`} className="font-medium text-marke">{p.jahr}</Link></td>
                  <td>{p.firma.name}</td>
                  <td>{p.bezeichnung}</td>
                  <td className="text-right">{r.stundensatz ? euro(r.stundensatz) : "–"}</td>
                  <td className="text-right">{r.materialAufschlag.toLocaleString("de-DE")} %</td>
                  <td className="text-right">{euro(r.planergebnis)}</td>
                  <td>{p.uebernommenAm ? datum(p.uebernommenAm) : "–"}</td>
                </tr>
              );
            })}
            {plaene.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Noch kein Plan.</td></tr>}
          </tbody>
        </table>
      </div>
      <form action={planAnlegenAktion} className="karte flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Firma</label>
          <select name="firmaId" className="eingabe">{firmen.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        </div>
        <div><label className="label">Jahr</label><input name="jahr" defaultValue={new Date().getFullYear() + 1} inputMode="numeric" className="eingabe w-28" /></div>
        <button className="btn">Plan anlegen</button>
        <span className="text-xs text-slate-500">Gibt es einen Vorjahresplan, wird er kopiert.</span>
      </form>
    </div>
  );
}

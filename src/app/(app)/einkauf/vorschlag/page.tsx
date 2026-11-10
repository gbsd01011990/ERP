import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { bestellvorschlag } from "@/lib/dienste/einkauf";
import { euro } from "@/lib/format";
import { n } from "@/lib/kalkulation";
import { AktionsFormular } from "@/components/aktions-formular";
import { EinkaufNav } from "@/components/einkauf-nav";
import { vorschlagAktion } from "../actions";

const z3 = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 3 });

export default async function Vorschlag() {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const [liste, lager] = await Promise.all([bestellvorschlag(b), db.lager.findMany({ where: { firmaId: b.mandant.id, aktiv: true }, orderBy: { name: "asc" } })]);
  return (
    <div className="space-y-4">
      <h1 className="h1">Bestellvorschlag Lager</h1>
      <EinkaufNav aktiv="/einkauf/vorschlag" buero />
      <p className="max-w-3xl text-sm text-slate-600">Artikel unter Mindestbestand (alle Lager zusammen), abzüglich dessen, was schon bestellt und noch unterwegs ist. Vorgeschlagen wird das Doppelte der Fehlmenge; jede Menge lässt sich ändern. Daraus entsteht eine Bestellanforderung, in der du den Lieferanten wählst.</p>
      {liste.length === 0 ? <p className="karte text-sm text-slate-500">Alle Artikel mit Mindestbestand sind ausreichend vorrätig.</p> : (
        <AktionsFormular aktion={vorschlagAktion} knopf="Bestellanforderung anlegen" className="karte space-y-3 text-sm">
          <div><label className="label">Ziellager</label><select name="lagerId" className="eingabe w-auto">{lager.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <table className="tabelle">
            <thead><tr><th>Artikel</th><th>Lieferant (Notiz)</th><th className="text-right">Mindestbestand</th><th className="text-right">Bestand</th><th className="text-right">unterwegs</th><th className="text-right">letzter EK</th><th>bestellen</th></tr></thead>
            <tbody>
              {liste.map(({ a, bestand, unterwegs, vorschlag }) => (
                <tr key={a.id}>
                  <td>{a.nummer} {a.bezeichnung}</td><td>{a.lieferant ?? ""}</td>
                  <td className="text-right">{z3(n(a.mindestbestand))} {a.einheit}</td><td className="text-right">{z3(bestand)}</td><td className="text-right">{z3(unterwegs)}</td>
                  <td className="text-right">{euro(a.letzterEk ?? a.durchschnittEk)}</td>
                  <td><input name={`menge_${a.id}`} defaultValue={vorschlag} className="eingabe w-24" aria-label={`Menge ${a.bezeichnung}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </AktionsFormular>
      )}
    </div>
  );
}

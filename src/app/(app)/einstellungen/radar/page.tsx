import Link from "next/link";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit } from "@/lib/format";
import { laeufe, profilFuer } from "@/lib/dienste/radar";
import { AktionsFormular } from "@/components/aktions-formular";
import { laufAktion, profilAktion } from "../../ausschreibungen/actions";

const ARTEN = [["works", "Bauleistungen"], ["services", "Dienstleistungen"], ["supplies", "Lieferungen"], ["", "ohne Angabe"]] as const;

export default async function RadarEinstellungen() {
  const b = await benutzerPflicht(["ADMIN"]);
  const [p, l] = await Promise.all([profilFuer(b.mandant.id), laeufe(b)]);
  const feld = (name: string, titel: string, werte: string[], hilfe: string, zeilen = 3) => (
    <div>
      <label className="label" htmlFor={name}>{titel}</label>
      <textarea id={name} name={name} defaultValue={werte.join(", ")} rows={zeilen} className="eingabe w-full font-mono text-xs" />
      <p className="mt-1 text-xs text-slate-500">{hilfe}</p>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="h1">Ausschreibungs-Radar · {b.mandant.name}</h1>
        <Link href="/ausschreibungen" className="btn-hell">Zu den Ausschreibungen</Link>
      </div>
      <p className="text-sm text-slate-600">
        Jeden Morgen gegen 6:30 Uhr ruft das Radar die Bekanntmachungen des Vortags ab und bewertet sie für jede Firma mit ihrem eigenen Profil.
        Ein CPV-Treffer bringt {p.scoreCpv} Punkte, ein Stichwort im Titel {p.scoreTitel}, in der Beschreibung {p.scoreText}. Ab {p.mindestScore} Punkten erscheint die Ausschreibung.
      </p>

      <AktionsFormular aktion={profilAktion} knopf="Profil speichern" className="karte grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="aktiv" defaultChecked={p.aktiv} /> Radar für {b.mandant.name} aktiv</label>
        {feld("regionNuts", "Regionen (NUTS-Codes)", p.regionNuts, "DE3 = Berlin, DE4 = Brandenburg. Präfixe genügen.", 2)}
        {feld("regionPlz", "Postleitzahl-Bereiche", p.regionPlz, "Anfang der PLZ, z. B. 14 für Potsdam und Werder.", 2)}
        {feld("cpvPraefixe", "CPV-Codes (Präfixe)", p.cpvPraefixe, "z. B. 77211 Baumpflege, 45112 Erdarbeiten Landschaftsbau.")}
        {feld("stichwoerter", "Stichwörter", p.stichwoerter, "Groß- und Kleinschreibung spielt keine Rolle; Wortanfänge genügen.", 5)}
        {feld("ausschluss", "Ausschlussbegriffe im Titel", p.ausschluss, "Steht einer davon im Titel, fällt die Ausschreibung raus.", 4)}
        <div className="space-y-3">
          <div>
            <span className="label">Auftragsarten</span>
            <div className="flex flex-wrap gap-4 text-sm">
              {ARTEN.map(([w, t]) => <label key={w || "leer"} className="flex items-center gap-1.5"><input type="checkbox" name="auftragsarten" value={w} defaultChecked={p.auftragsarten.includes(w)} /> {t}</label>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className="label" htmlFor="mindestScore">Mindestpunkte</label><input id="mindestScore" name="mindestScore" type="number" min={1} max={20} defaultValue={p.mindestScore} className="eingabe" /></div>
            <div><label className="label" htmlFor="scoreCpv">CPV</label><input id="scoreCpv" name="scoreCpv" type="number" min={0} max={10} defaultValue={p.scoreCpv} className="eingabe" /></div>
            <div><label className="label" htmlFor="scoreTitel">Titel</label><input id="scoreTitel" name="scoreTitel" type="number" min={0} max={10} defaultValue={p.scoreTitel} className="eingabe" /></div>
            <div><label className="label" htmlFor="scoreText">Beschreibung</label><input id="scoreText" name="scoreText" type="number" min={0} max={10} defaultValue={p.scoreText} className="eingabe" /></div>
          </div>
        </div>
      </AktionsFormular>

      <section className="karte space-y-3">
        <h2 className="font-semibold">Abruf von Hand</h2>
        <p className="text-sm text-slate-600">Holt die Bekanntmachungen der letzten Tage für alle drei Firmen. Bereits bekannte Ausschreibungen werden nur ergänzt.</p>
        <AktionsFormular aktion={laufAktion} knopf="Jetzt abrufen" knopfKlasse="btn-hell" className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="tage">Tage zurück</label><input id="tage" name="tage" type="number" min={1} max={14} defaultValue={3} className="eingabe w-24" /></div>
        </AktionsFormular>
        <table className="tabelle">
          <thead><tr><th>Start</th><th>Tage</th><th className="text-right">Treffer</th><th className="text-right">neu</th><th>Ergebnis</th></tr></thead>
          <tbody>
            {l.map((x) => (
              <tr key={x.id}>
                <td>{datumZeit(x.start)}</td>
                <td>{x.tage.length > 1 ? `${x.tage[0]} bis ${x.tage[x.tage.length - 1]}` : x.tage[0]}</td>
                <td className="text-right">{x.treffer}</td>
                <td className="text-right">{x.neu}</td>
                <td>
                  {!x.ende ? <span className="text-amber-700">läuft …</span> : x.fehler ? <span className="text-red-600">{x.fehler}</span> : <span className="text-emerald-700">ok</span>}
                  {x.protokoll && <details><summary className="cursor-pointer text-xs text-slate-500">Protokoll</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{x.protokoll}</pre></details>}
                </td>
              </tr>
            ))}
            {!l.length && <tr><td colSpan={5} className="text-slate-500">Noch kein Abruf.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

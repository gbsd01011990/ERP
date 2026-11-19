import Link from "next/link";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit } from "@/lib/format";
import { BERECHTIGTE, BEREICHE, REGIONEN, laeufe, profilFuer } from "@/lib/dienste/foerdermittel";
import { AktionsFormular } from "@/components/aktions-formular";
import { laufAktion, profilAktion } from "../../foerdermittel/actions";

export default async function FoerderEinstellungen() {
  const b = await benutzerPflicht(["ADMIN"]);
  const [p, l] = await Promise.all([profilFuer(b.mandant.id), laeufe(b)]);
  const text = (name: string, titel: string, werte: string[], hilfe: string, zeilen = 4) => (
    <div>
      <label className="label" htmlFor={name}>{titel}</label>
      <textarea id={name} name={name} defaultValue={werte.join(", ")} rows={zeilen} className="eingabe w-full font-mono text-xs" />
      <p className="mt-1 text-xs text-slate-500">{hilfe}</p>
    </div>
  );
  const haken = (name: string, titel: string, alle: readonly string[], gewaehlt: string[]) => (
    <fieldset>
      <legend className="label">{titel}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {alle.map((w) => <label key={w} className="flex items-center gap-1.5"><input type="checkbox" name={name} value={w} defaultChecked={gewaehlt.includes(w)} /> {w}</label>)}
      </div>
    </fieldset>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="h1">Fördermittel-Radar · {b.mandant.name}</h1>
        <Link href="/foerdermittel" className="btn-hell">Zu den Fördermitteln</Link>
      </div>
      <p className="max-w-3xl text-sm text-slate-600">
        Jeden Morgen liest das Radar die Förderdatenbank des Bundes für die gewählten Fördergebiete und prüft jedes Programm zweimal:
        für den eigenen Betrieb (Antragsteller „Unternehmen“) und für Kunden. Ein Stichwort im Titel bringt {p.scoreTitel} Punkte,
        jedes im Text {p.scoreText} (höchstens zwei), ein passender Förderbereich {p.scoreBereich}. Ab {p.mindestScore} Punkten erscheint das Programm.
        Nach dem Speichern bewertet das Radar alle bekannten Programme sofort neu.
      </p>

      <AktionsFormular aktion={profilAktion} knopf="Profil speichern" className="karte grid gap-5 md:grid-cols-2">
        <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="aktiv" defaultChecked={p.aktiv} /> Fördermittel-Radar für {b.mandant.name} aktiv</label>
        <div className="md:col-span-2">{haken("regionen", "Fördergebiete", REGIONEN, p.regionen)}</div>
        <h2 className="font-semibold text-sky-800 md:col-span-2">Für den Betrieb</h2>
        {text("stichwoerterBetrieb", "Stichwörter", p.stichwoerterBetrieb, "Wortanfänge genügen, z. B. „energieeffizien“ findet Energieeffizienz und energieeffizient.", 5)}
        {haken("bereicheBetrieb", "Passende Förderbereiche (Zusatzpunkt)", BEREICHE, p.bereicheBetrieb)}
        <h2 className="font-semibold text-emerald-800 md:col-span-2">Für Kunden</h2>
        {text("stichwoerterKunde", "Stichwörter", p.stichwoerterKunde, "Vorsicht mit kurzen Wörtern: „baum“ steckt auch in „Baumaßnahme“.", 6)}
        <div className="space-y-4">
          {haken("bereicheKunde", "Passende Förderbereiche (Zusatzpunkt)", BEREICHE, p.bereicheKunde)}
          {haken("berechtigteKunde", "Wer beantragt (Kunden)", BERECHTIGTE, p.berechtigteKunde)}
        </div>
        {text("ausschluss", "Ausschlussbegriffe im Titel", p.ausschluss, "Steht einer davon im Titel, fällt das Programm raus.", 3)}
        <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-4">
          <div><label className="label" htmlFor="mindestScore">Mindestpunkte</label><input id="mindestScore" name="mindestScore" type="number" min={1} max={20} defaultValue={p.mindestScore} className="eingabe" /></div>
          <div><label className="label" htmlFor="scoreTitel">Titel</label><input id="scoreTitel" name="scoreTitel" type="number" min={0} max={10} defaultValue={p.scoreTitel} className="eingabe" /></div>
          <div><label className="label" htmlFor="scoreText">Text</label><input id="scoreText" name="scoreText" type="number" min={0} max={10} defaultValue={p.scoreText} className="eingabe" /></div>
          <div><label className="label" htmlFor="scoreBereich">Bereich</label><input id="scoreBereich" name="scoreBereich" type="number" min={0} max={10} defaultValue={p.scoreBereich} className="eingabe" /></div>
        </div>
      </AktionsFormular>

      <section className="karte space-y-3">
        <h2 className="font-semibold">Abruf von Hand</h2>
        <p className="text-sm text-slate-600">
          Liest alle Programme für Bund, Berlin und Brandenburg und lädt die Einzelseiten passender Programme (höchstens 120 je Lauf, mit Pausen,
          damit die Förderdatenbank uns nicht sperrt). Der erste Lauf braucht deshalb zwei bis drei Tage, bis alle Einzelseiten da sind.
        </p>
        <AktionsFormular aktion={laufAktion} knopf="Jetzt abrufen" knopfKlasse="btn-hell" />
        <table className="tabelle">
          <thead><tr><th>Start</th><th className="text-right">Programme</th><th className="text-right">Einzelseiten</th><th className="text-right">neu</th><th className="text-right">beendet</th><th>Ergebnis</th></tr></thead>
          <tbody>
            {l.map((x) => (
              <tr key={x.id}>
                <td>{datumZeit(x.start)}</td>
                <td className="text-right">{x.programme}</td>
                <td className="text-right">{x.details}</td>
                <td className="text-right">{x.neu}</td>
                <td className="text-right">{x.beendet}</td>
                <td>
                  {!x.ende ? <span className="text-amber-700">läuft …</span> : x.fehler ? <span className="text-red-600">{x.fehler}</span> : <span className="text-emerald-700">ok</span>}
                  {x.protokoll && <details><summary className="cursor-pointer text-xs text-slate-500">Protokoll</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{x.protokoll}</pre></details>}
                </td>
              </tr>
            ))}
            {!l.length && <tr><td colSpan={6} className="text-slate-500">Noch kein Abruf.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

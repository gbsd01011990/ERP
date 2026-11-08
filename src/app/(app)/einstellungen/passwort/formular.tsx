"use client";
import { useFormularAktion } from "@/components/formular-aktion";
import { passwortAendernAktion } from "./actions";

export function PasswortFormular({ mindestlaenge }: { mindestlaenge: number }) {
  const { state, onSubmit, laeuft } = useFormularAktion(passwortAendernAktion);
  return (
    <form onSubmit={onSubmit} className="karte max-w-sm space-y-4" key={state && "ok" in state ? "fertig" : "offen"}>
      <div>
        <label className="label" htmlFor="aktuell">Bisheriges Passwort</label>
        <input id="aktuell" name="aktuell" type="password" required autoComplete="current-password" className="eingabe" />
      </div>
      <div>
        <label className="label" htmlFor="neu">Neues Passwort</label>
        <input id="neu" name="neu" type="password" required minLength={mindestlaenge} autoComplete="new-password" className="eingabe" />
        <p className="mt-1 text-xs text-slate-500">Mindestens {mindestlaenge} Zeichen.</p>
      </div>
      <div>
        <label className="label" htmlFor="wiederholung">Neues Passwort wiederholen</label>
        <input id="wiederholung" name="wiederholung" type="password" required minLength={mindestlaenge} autoComplete="new-password" className="eingabe" />
      </div>
      {state && "fehler" in state && <p className="text-sm text-red-600">{state.fehler}</p>}
      {state && "ok" in state && <p className="text-sm text-green-700">Passwort geändert. Andere Geräte sind jetzt abgemeldet.</p>}
      <button className="btn w-full justify-center" disabled={laeuft}>Passwort ändern</button>
    </form>
  );
}

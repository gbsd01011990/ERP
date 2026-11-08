"use client";
import { useFormularAktion } from "@/components/formular-aktion";
import { einsatzAktion } from "./actions";

export function EinsatzFormular({ geraetId, projekte, heute }: { geraetId: string; projekte: { id: string; text: string }[]; heute: string }) {
  const { state, onSubmit, laeuft } = useFormularAktion(einsatzAktion);
  return (
    <form onSubmit={onSubmit} key={state?.ok ? state.zeit : undefined} className="grid gap-3 md:grid-cols-6">
      <input type="hidden" name="geraetId" value={geraetId} />
      <div className="md:col-span-2">
        <label className="label" htmlFor="projektId">Projekt</label>
        <select id="projektId" name="projektId" required className="eingabe">
          <option value="">Bitte wählen …</option>
          {projekte.map((p) => <option key={p.id} value={p.id}>{p.text}</option>)}
        </select>
      </div>
      <div><label className="label" htmlFor="datum">Datum</label><input id="datum" name="datum" type="date" defaultValue={heute} className="eingabe" /></div>
      <div><label className="label" htmlFor="stunden">Stunden</label><input id="stunden" name="stunden" required inputMode="decimal" className="eingabe" /></div>
      <div><label className="label" htmlFor="notiz-e">Notiz</label><input id="notiz-e" name="notiz" className="eingabe" /></div>
      <div className="flex items-end"><button className="btn" disabled={laeuft}>Erfassen</button></div>
      {state?.fehler && <p className="text-sm text-red-600 md:col-span-6" role="alert">{state.fehler}</p>}
      {state?.ok && <p className="text-sm text-emerald-700 md:col-span-6" role="status">{state.ok}</p>}
    </form>
  );
}

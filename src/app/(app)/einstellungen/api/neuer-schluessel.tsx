"use client";
import { useFormularAktion } from "@/components/formular-aktion";
import { schluesselErstellen } from "./actions";

export function NeuerSchluessel() {
  const { state, onSubmit, laeuft } = useFormularAktion(schluesselErstellen);
  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" name="name" placeholder="z. B. Zapier" className="eingabe w-64" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="nurLesen" /> nur lesen</label>
        <button className="btn" disabled={laeuft}>Schlüssel erzeugen</button>
      </form>
      {state && "fehler" in state && <p className="text-sm text-red-600">{state.fehler}</p>}
      {state && "klartext" in state && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Schlüssel „{state.name}“ – jetzt kopieren, er wird nur einmal angezeigt:</p>
          <code className="mt-2 block break-all rounded bg-white p-2 font-mono text-xs" data-testid="klartext">{state.klartext}</code>
        </div>
      )}
    </div>
  );
}

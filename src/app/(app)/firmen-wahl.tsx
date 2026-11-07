"use client";
import { firmaWaehlen } from "./actions";

type Firma = { id: string; kuerzel: string; name: string };

export function FirmenWahl({ firmen, aktiv }: { firmen: Firma[]; aktiv: string }) {
  return (
    <form action={firmaWaehlen}>
      <select
        name="firma"
        defaultValue={aktiv}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        aria-label="Firma wählen"
      >
        {firmen.length > 1 && <option value="alle">Alle Firmen</option>}
        {firmen.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
    </form>
  );
}

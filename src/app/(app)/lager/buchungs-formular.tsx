"use client";
import { useFormularAktion } from "@/components/formular-aktion";
import { useState } from "react";
import { buchenAktion } from "./actions";

type Opt = { id: string; text: string };
const ARTEN = [
  ["PROJEKT", "Entnahme auf Projekt"],
  ["ZUGANG", "Zugang (Wareneingang)"],
  ["UMBUCHUNG", "Umbuchung"],
  ["ABGANG", "Abgang (Verbrauch, Schwund)"],
  ["INVENTUR", "Inventur (gezählter Bestand)"],
] as const;

export function BuchungsFormular({ artikel, lager, projekte, nurEntnahme, vorauswahl }: {
  artikel: Opt[]; lager: Opt[]; projekte: Opt[]; nurEntnahme?: boolean; vorauswahl?: string;
}) {
  const [art, setArt] = useState<string>("PROJEKT");
  const { state, onSubmit, laeuft } = useFormularAktion(buchenAktion);
  const arten = nurEntnahme ? ARTEN.filter(([a]) => a !== "ZUGANG" && a !== "INVENTUR") : ARTEN;
  const von = art === "ABGANG" || art === "PROJEKT" || art === "UMBUCHUNG";
  const nach = art === "ZUGANG" || art === "UMBUCHUNG" || art === "INVENTUR";
  const sel = (name: string, label: string, opts: Opt[], pflicht = true, def?: string) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} required={pflicht} defaultValue={def} className="eingabe">
        <option value="">Bitte wählen …</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
      </select>
    </div>
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-4" key={state?.ok ? state.zeit : undefined}>
      <div>
        <label className="label" htmlFor="art">Buchungsart</label>
        <select id="art" name="art" value={art} onChange={(e) => setArt(e.target.value)} className="eingabe">
          {arten.map(([a, t]) => <option key={a} value={a}>{t}</option>)}
        </select>
      </div>
      <div className="md:col-span-2">{sel("artikelId", "Artikel", artikel, true, vorauswahl)}</div>
      <div>
        <label className="label" htmlFor="menge">{art === "INVENTUR" ? "Gezählter Bestand" : "Menge"}</label>
        <input id="menge" name="menge" required inputMode="decimal" className="eingabe" />
      </div>
      {von && sel("vonLagerId", art === "UMBUCHUNG" ? "Von Lager" : "Aus Lager", lager)}
      {nach && sel("nachLagerId", art === "INVENTUR" ? "Lager" : art === "UMBUCHUNG" ? "Nach Lager" : "In Lager", lager)}
      {art === "PROJEKT" && <div className="md:col-span-2">{sel("projektId", "Projekt", projekte)}</div>}
      {art === "ZUGANG" && (
        <div>
          <label className="label" htmlFor="ekPreis">EK je Einheit €</label>
          <input id="ekPreis" name="ekPreis" required inputMode="decimal" className="eingabe" />
        </div>
      )}
      <div><label className="label" htmlFor="beleg">Beleg</label><input id="beleg" name="beleg" placeholder="Lieferschein-Nr." className="eingabe" /></div>
      <div className="md:col-span-2"><label className="label" htmlFor="notiz">Notiz</label><input id="notiz" name="notiz" className="eingabe" /></div>
      <div className="flex items-end gap-3 md:col-span-4">
        <button className="btn" disabled={laeuft}>Buchen</button>
        {state?.fehler && <span className="text-sm text-red-600" role="alert">{state.fehler}</span>}
        {state?.ok && <span className="text-sm text-emerald-700" role="status">{state.ok}</span>}
      </div>
    </form>
  );
}

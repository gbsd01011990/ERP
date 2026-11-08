"use client";
import { useFormularAktion } from "@/components/formular-aktion";
import { eintragAktion } from "./actions";
import { KATEGORIE_TEXT } from "@/lib/zeit-texte";

type Opt = { id: string; text: string };
export type EintragWerte = { id?: string; tag: string; von: string; bis: string; kategorie: string; projektId: string | null; notiz: string | null };

/** Formular für einen Eintrag von Hand oder zum Korrigieren. */
export function EintragFormular({ benutzerId, projekte, werte, gesperrt }: { benutzerId: string; projekte: Opt[]; werte: EintragWerte; gesperrt?: boolean }) {
  const { state, onSubmit, laeuft } = useFormularAktion(eintragAktion);
  return (
    <form onSubmit={onSubmit} key={state?.ok ? state.zeit : undefined} className="grid grid-cols-2 gap-2 sm:grid-cols-[9rem_6rem_6rem_10rem_1fr]">
      <input type="hidden" name="benutzerId" value={benutzerId} />
      {werte.id && <input type="hidden" name="id" value={werte.id} />}
      <fieldset disabled={gesperrt} className="contents">
        <div className="col-span-2 sm:col-span-1"><label className="label">Datum</label><input type="date" name="tag" required defaultValue={werte.tag} className="eingabe" /></div>
        <div><label className="label">von</label><input type="time" name="von" required defaultValue={werte.von} className="eingabe" /></div>
        <div><label className="label">bis</label><input type="time" name="bis" required defaultValue={werte.bis} className="eingabe" /></div>
        <div>
          <label className="label">Tätigkeit</label>
          <select name="kategorie" defaultValue={werte.kategorie} className="eingabe">
            {Object.entries(KATEGORIE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label">Projekt</label>
          <select name="projektId" defaultValue={werte.projektId ?? ""} className="eingabe">
            <option value="">– ohne Projekt –</option>
            {projekte.map((p) => <option key={p.id} value={p.id}>{p.text}</option>)}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-4"><label className="label">Notiz</label><input name="notiz" defaultValue={werte.notiz ?? ""} className="eingabe" /></div>
        <div className="col-span-2 flex items-end sm:col-span-1"><button className="btn w-full justify-center" disabled={laeuft}>{werte.id ? "Speichern" : "Eintragen"}</button></div>
      </fieldset>
      {state?.fehler && <p className="col-span-2 text-sm text-red-600 sm:col-span-5" role="alert">{state.fehler}</p>}
      {state?.ok && <p className="col-span-2 text-sm text-emerald-700 sm:col-span-5" role="status">{state.ok}</p>}
    </form>
  );
}

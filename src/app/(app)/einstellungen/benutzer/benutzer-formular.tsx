"use client";
import { useFormularAktion } from "@/components/formular-aktion";
import { benutzerAktion } from "./actions";

type Firma = { id: string; name: string };
type Werte = { id: string; name: string; email: string; rolle: string; aktiv: boolean; firmen: string[] };

const ROLLEN = { KOLONNE: "Kolonne (Zeiten, Material, Geräte)", BUERO: "Büro (alles außer Plankosten und Benutzer)", ADMIN: "Admin (alles)" };

export function BenutzerFormular({ firmen, werte, mandantId }: { firmen: Firma[]; werte?: Werte; mandantId: string }) {
  const { state, onSubmit, laeuft } = useFormularAktion(benutzerAktion);
  return (
    <form onSubmit={onSubmit} key={!werte && state?.ok ? state.zeit : undefined} className="grid gap-3 md:grid-cols-4">
      {werte && <input type="hidden" name="id" value={werte.id} />}
      <div><label className="label">Name</label><input name="name" required defaultValue={werte?.name} className="eingabe" /></div>
      <div><label className="label">E-Mail (Anmeldung)</label><input name="email" type="email" required defaultValue={werte?.email} className="eingabe" /></div>
      <div>
        <label className="label">Rolle</label>
        <select name="rolle" defaultValue={werte?.rolle ?? "KOLONNE"} className="eingabe">
          {Object.entries(ROLLEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="label">{werte ? "Neues Passwort (leer = unverändert)" : "Startpasswort"}</label>
        <input name="passwort" type="text" autoComplete="new-password" required={!werte} minLength={12} placeholder="mind. 12 Zeichen" className="eingabe" />
      </div>
      <fieldset className="md:col-span-3">
        <legend className="label">Zugang zu Mandanten</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {firmen.map((f) => (
            <label key={f.id} className="flex items-center gap-2">
              <input type="checkbox" name="firmen" value={f.id} defaultChecked={werte ? werte.firmen.includes(f.id) : f.id === mandantId} /> {f.name}
            </label>
          ))}
        </div>
      </fieldset>
      {werte && (
        <div>
          <label className="label">Status</label>
          <select name="aktiv" defaultValue={werte.aktiv ? "an" : "aus"} className="eingabe"><option value="an">aktiv</option><option value="aus">gesperrt</option></select>
        </div>
      )}
      <div className="flex items-end gap-3 md:col-span-4">
        <button className="btn" disabled={laeuft}>{werte ? "Speichern" : "Benutzer anlegen"}</button>
        {state?.fehler && <span className="text-sm text-red-600" role="alert">{state.fehler}</span>}
        {state?.ok && <span className="text-sm text-emerald-700" role="status">{state.ok}</span>}
      </div>
    </form>
  );
}

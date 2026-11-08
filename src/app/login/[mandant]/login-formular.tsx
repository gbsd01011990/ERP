"use client";
import { useFormularAktion } from "@/components/formular-aktion";
import { loginAktion } from "../actions";

export function LoginFormular({ slug, name }: { slug: string; name: string }) {
  const { state, onSubmit, laeuft } = useFormularAktion(loginAktion);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="mandant" value={slug} />
      <div>
        <label className="label" htmlFor="email">E-Mail</label>
        <input id="email" name="email" type="email" required autoComplete="username" defaultValue={state?.email} className="eingabe" />
      </div>
      <div>
        <label className="label" htmlFor="passwort">Passwort</label>
        <input id="passwort" name="passwort" type="password" required autoComplete="current-password" className="eingabe" />
      </div>
      {state?.fehler && <p className="text-sm text-red-600" role="alert">{state.fehler}</p>}
      <button className="btn w-full justify-center" disabled={laeuft}>Bei {name} anmelden</button>
    </form>
  );
}

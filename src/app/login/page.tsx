"use client";
import { useActionState } from "react";
import { loginAktion } from "./actions";

export default function LoginSeite() {
  const [state, aktion, laeuft] = useActionState(loginAktion, null);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={aktion} className="karte w-full max-w-sm space-y-4">
        <h1 className="h1">Anmelden</h1>
        <div>
          <label className="label" htmlFor="email">E-Mail</label>
          <input id="email" name="email" type="email" required autoComplete="username" defaultValue={state?.email} className="eingabe" />
        </div>
        <div>
          <label className="label" htmlFor="passwort">Passwort</label>
          <input id="passwort" name="passwort" type="password" required autoComplete="current-password" className="eingabe" />
        </div>
        {state?.fehler && <p className="text-sm text-red-600">{state.fehler}</p>}
        <button className="btn w-full justify-center" disabled={laeuft}>Anmelden</button>
      </form>
    </main>
  );
}

import { benutzerPflicht, PASSWORT_MINDESTLAENGE } from "@/lib/auth";
import { PasswortFormular } from "./formular";

export default async function PasswortSeite() {
  const b = await benutzerPflicht();
  return (
    <div className="space-y-4">
      <h1 className="h1">Passwort ändern</h1>
      <p className="text-sm text-slate-600">Angemeldet als {b.email}.</p>
      <PasswortFormular mindestlaenge={PASSWORT_MINDESTLAENGE} />
    </div>
  );
}

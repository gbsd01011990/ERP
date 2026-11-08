import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { BenutzerFormular } from "./benutzer-formular";

const ROLLE = { ADMIN: "Admin", BUERO: "Büro", KOLONNE: "Kolonne" } as const;

export default async function Benutzerverwaltung() {
  const b = await benutzerPflicht(["ADMIN"]);
  // Mandanten, auf die der Admin insgesamt Zugriff hat (nicht nur der angemeldete)
  const eigene = await db.zugriff.findMany({ where: { benutzerId: b.id }, include: { firma: true } });
  const firmen = eigene.map((z) => z.firma).sort((a, c) => a.name.localeCompare(c.name));
  const benutzer = await db.benutzer.findMany({
    where: { zugriffe: { some: { firmaId: { in: firmen.map((f) => f.id) } } } },
    include: { zugriffe: { include: { firma: true } } },
    orderBy: [{ aktiv: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-4">
      <h1 className="h1">Benutzer</h1>
      <details className="karte">
        <summary className="cursor-pointer font-semibold">+ Neuer Benutzer</summary>
        <div className="mt-4"><BenutzerFormular firmen={firmen} mandantId={b.mandant.id} /></div>
      </details>
      <div className="karte p-0">
        {benutzer.map((u) => (
          <details key={u.id} className="border-b border-slate-100">
            <summary className={`flex cursor-pointer list-none flex-wrap gap-x-4 px-4 py-2 text-sm ${u.aktiv ? "" : "opacity-50"}`}>
              <span className="w-48 font-medium">{u.name}</span>
              <span className="flex-1 text-slate-600">{u.email}</span>
              <span className="w-20">{ROLLE[u.rolle]}</span>
              <span className="text-slate-500">{u.zugriffe.map((z) => z.firma.kuerzel).sort().join(", ")}</span>
              {!u.aktiv && <span className="text-red-600">gesperrt</span>}
            </summary>
            <div className="bg-slate-50 px-4 py-3">
              <BenutzerFormular
                firmen={firmen}
                mandantId={b.mandant.id}
                werte={{ id: u.id, name: u.name, email: u.email, rolle: u.rolle, aktiv: u.aktiv, firmen: u.zugriffe.map((z) => z.firmaId) }}
              />
            </div>
          </details>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Nach dem Zurücksetzen des Passworts oder dem Sperren wird der Benutzer überall abgemeldet. Neue Mitarbeiter bitten, das Startpasswort unter „Passwort ändern“ sofort zu ersetzen.
      </p>
    </div>
  );
}

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit } from "@/lib/format";
import { NeuerSchluessel } from "./neuer-schluessel";
import { schluesselWiderrufen } from "./actions";

export default async function ApiEinstellungen() {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const h = await headers();
  const basis = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const schluessel = await db.apiSchluessel.findMany({
    where: { firmaId: b.mandant.id, ...(b.rolle === "ADMIN" ? {} : { benutzerId: b.id }) },
    include: { benutzer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const beispiel = `curl -X POST ${basis}/api/graphql \\
  -H "Authorization: Bearer erp_…" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"{ projekte(nurOffen: true, first: 10) { gesamt eintraege { nummer titel status { name } kontakt { anzeigename } } } }"}'`;

  return (
    <div className="space-y-4">
      <h1 className="h1">GraphQL-Schnittstelle</h1>

      <section className="karte space-y-2 text-sm">
        <p>
          Adresse: <code className="rounded bg-slate-100 px-1">{basis}/api/graphql</code>. Ein Schlüssel gilt nur für den Mandanten {b.mandant.name} und hat
          die Rolle des Benutzers, der ihn erzeugt hat. Ein Schlüssel mit „nur lesen“ kann keine Daten ändern.
        </p>
        <p>
          Im Browser öffnet die Adresse den Abfrage-Editor GraphiQL mit allen Typen und Feldern. Dort gilt deine aktuelle Anmeldung, kein Schlüssel nötig.{" "}
          <a href="/api/graphql" target="_blank" className="text-marke">GraphiQL öffnen</a>
        </p>
        <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{beispiel}</pre>
      </section>

      <section className="karte space-y-3">
        <h2 className="font-semibold">Neuer Schlüssel</h2>
        <NeuerSchluessel />
      </section>

      <section className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Name</th><th>Anfang</th><th>Benutzer</th><th>Rechte</th><th>Erzeugt</th><th>Zuletzt genutzt</th><th /></tr></thead>
          <tbody>
            {schluessel.map((s) => (
              <tr key={s.id} className={s.widerrufenAm ? "text-slate-400" : ""}>
                <td>{s.name}</td>
                <td className="font-mono text-xs">{s.anfang}…</td>
                <td>{s.benutzer.name}</td>
                <td>{s.nurLesen ? "nur lesen" : "lesen und schreiben"}</td>
                <td>{datumZeit(s.createdAt)}</td>
                <td>{s.letzteNutzung ? datumZeit(s.letzteNutzung) : "–"}</td>
                <td className="text-right">
                  {s.widerrufenAm ? `widerrufen ${datumZeit(s.widerrufenAm)}` : (
                    <form action={schluesselWiderrufen}><input type="hidden" name="id" value={s.id} /><button className="text-red-600">Widerrufen</button></form>
                  )}
                </td>
              </tr>
            ))}
            {schluessel.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-slate-500">Noch keine Schlüssel.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

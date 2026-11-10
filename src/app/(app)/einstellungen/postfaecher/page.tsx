import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit } from "@/lib/format";
import { msZugang } from "@/lib/dienste/mail";
import { AktionsFormular } from "@/components/aktions-formular";
import { msZugangAktion, postfachAktion, postfachEntfernenAktion } from "../../posteingang/actions";

type Mitarbeiter = { id: string; name: string; email: string };
type PF = { id: string; art: "PERSOENLICH" | "GETEILT"; adresse: string; name: string | null; benutzerId: string | null; zugriffe: string[]; rechnungseingang: boolean; lieferscheineingang: boolean };

function PostfachFormular({ mitarbeiter, p }: { mitarbeiter: Mitarbeiter[]; p?: PF }) {
  return (
    <AktionsFormular aktion={postfachAktion} knopf={p ? "Speichern" : "Postfach anlegen"} zuruecksetzen={!p} className="grid gap-3 md:grid-cols-4">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div>
        <label className="label">Art</label>
        <select name="art" defaultValue={p?.art ?? "PERSOENLICH"} className="eingabe">
          <option value="PERSOENLICH">Persönlich (eines Mitarbeiters)</option>
          <option value="GETEILT">Geteilt (z. B. info@, rechnung@)</option>
        </select>
      </div>
      <div><label className="label">Postfachadresse</label><input name="adresse" type="email" required defaultValue={p?.adresse} placeholder="name@firma.de" className="eingabe" /></div>
      <div><label className="label">Anzeigename (optional)</label><input name="name" defaultValue={p?.name ?? ""} placeholder="z. B. Info, Rechnungen" className="eingabe" /></div>
      <div>
        <label className="label">Mitarbeiter (bei persönlich)</label>
        <select name="benutzerId" defaultValue={p?.benutzerId ?? ""} className="eingabe">
          <option value="">–</option>
          {mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <fieldset className="md:col-span-4">
        <legend className="label">Freigegeben für (bei geteilt)</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {mitarbeiter.map((m) => (
            <label key={m.id} className="flex items-center gap-2"><input type="checkbox" name="zugriffe" value={m.id} defaultChecked={p?.zugriffe.includes(m.id)} /> {m.name}</label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm md:col-span-4">
        <input type="checkbox" name="rechnungseingang" defaultChecked={p?.rechnungseingang ?? false} /> Rechnungseingang: PDF- und XML-Anhänge als Eingangsrechnung erfassen (z. B. rechnung@)
      </label>
      <label className="flex items-center gap-2 text-sm md:col-span-4">
        <input type="checkbox" name="lieferscheineingang" defaultChecked={p?.lieferscheineingang ?? false} /> Lieferscheineingang: Fotos und PDFs als Lieferschein erfassen (z. B. lieferschein@ – Kolonnen schicken das Foto einfach dorthin)
      </label>
    </AktionsFormular>
  );
}

export default async function Postfaecher() {
  const b = await benutzerPflicht(["ADMIN"]);
  const f = await db.firma.findUniqueOrThrow({ where: { id: b.mandant.id } });
  const [zugang, postfaecher, mitarbeiter] = await Promise.all([
    msZugang(b.mandant.id).catch(() => null),
    db.postfach.findMany({ where: { firmaId: b.mandant.id }, include: { benutzer: true, zugriffe: { include: { benutzer: true } }, _count: { select: { emails: true } } }, orderBy: [{ aktiv: "desc" }, { art: "asc" }, { adresse: "asc" }] }),
    db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: b.mandant.id } } }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
  ]);
  const ohnePostfach = mitarbeiter.filter((m) => !postfaecher.some((p) => p.aktiv && p.art === "PERSOENLICH" && p.benutzerId === m.id));

  return (
    <div className="space-y-4">
      <h1 className="h1">Postfächer · {b.mandant.name}</h1>

      <section className="karte space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Verbindung zu Microsoft 365</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs ${zugang ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{zugang ? "eingerichtet" : "nicht eingerichtet"}</span>
        </div>
        <p className="text-sm text-slate-600">
          Werte aus der App-Registrierung in Microsoft Entra ID (Anleitung: <code>deploy/MICROSOFT.md</code>). Beim Speichern prüft das ERP die Anmeldung bei Microsoft.
        </p>
        <AktionsFormular aktion={msZugangAktion} knopf="Prüfen und speichern" className="grid gap-3 md:grid-cols-3">
          <div><label className="label">Verzeichnis-ID (Tenant-ID)</label><input name="tenantId" required defaultValue={f.msTenantId ?? ""} className="eingabe font-mono text-xs" /></div>
          <div><label className="label">Anwendungs-ID (Client-ID)</label><input name="clientId" required defaultValue={f.msClientId ?? ""} className="eingabe font-mono text-xs" /></div>
          <div>
            <label className="label">Geheimer Clientschlüssel</label>
            <input name="clientSecret" type="password" autoComplete="off" placeholder={f.msClientSecret ? "gespeichert – leer lassen zum Behalten" : ""} className="eingabe" />
          </div>
        </AktionsFormular>
      </section>

      <section className="karte overflow-x-auto p-0">
        <h2 className="px-4 pt-4 font-semibold">Postfächer</h2>
        <table className="tabelle mt-2">
          <thead><tr><th>Postfach</th><th>Art</th><th>Mitarbeiter / Freigaben</th><th className="text-right">Mails</th><th>Letzter Abruf</th><th /></tr></thead>
          <tbody>
            {postfaecher.map((p) => (
              <tr key={p.id} className={p.aktiv ? "" : "opacity-50"}>
                <td colSpan={6} className="p-0">
                  <details>
                    <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] gap-2 px-3 py-2 text-sm md:grid-cols-[16rem_7rem_1fr_4rem_10rem_6rem]">
                      <span className="font-medium">{p.name ? `${p.name} · ` : ""}{p.adresse}</span>
                      <span>{p.art === "GETEILT" ? "geteilt" : "persönlich"}</span>
                      <span className="text-slate-600">{p.art === "PERSOENLICH" ? p.benutzer?.name ?? "–" : p.zugriffe.map((z) => z.benutzer.name).join(", ") || "noch niemand"}</span>
                      <span className="text-right">{p._count.emails}</span>
                      <span className={p.fehler ? "text-red-600" : "text-slate-500"} title={p.fehler ?? ""}>{p.fehler ? "Fehler" : p.letzterAbruf ? datumZeit(p.letzterAbruf) : "–"}</span>
                      <span className="text-right text-xs text-marke">{p.aktiv ? "bearbeiten" : "abgeschaltet"}</span>
                    </summary>
                    <div className="space-y-3 bg-slate-50 px-4 py-3">
                      {p.fehler && <p className="text-sm text-red-600">{p.fehler}</p>}
                      <PostfachFormular mitarbeiter={mitarbeiter} p={{ id: p.id, art: p.art, adresse: p.adresse, name: p.name, benutzerId: p.benutzerId, zugriffe: p.zugriffe.map((z) => z.benutzerId), rechnungseingang: p.rechnungseingang, lieferscheineingang: p.lieferscheineingang }} />
                      {p.aktiv && (
                        <form action={postfachEntfernenAktion}>
                          <input type="hidden" name="id" value={p.id} />
                          <button className="text-xs text-red-600">Abruf abschalten (Mails bleiben erhalten)</button>
                        </form>
                      )}
                    </div>
                  </details>
                </td>
              </tr>
            ))}
            {postfaecher.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">Noch keine Postfächer.</td></tr>}
          </tbody>
        </table>
      </section>

      {ohnePostfach.length > 0 && (
        <p className="text-sm text-amber-700">Ohne persönliches Postfach: {ohnePostfach.map((m) => `${m.name} (${m.email})`).join(", ")}</p>
      )}

      <details className="karte" open={postfaecher.length === 0}>
        <summary className="cursor-pointer font-semibold">+ Postfach hinzufügen</summary>
        <div className="mt-4"><PostfachFormular mitarbeiter={mitarbeiter} /></div>
      </details>
      <p className="text-xs text-slate-500">
        Mitarbeiter sehen nicht zugeordnete Mails nur aus ihrem eigenen und aus freigegebenen Postfächern. Mails, die einem Kontakt oder Projekt
        zugeordnet sind, sieht das Büro beim Kontakt und Projekt. Admins verwalten Postfächer, lesen fremde aber nur mit Freigabe.
      </p>
    </div>
  );
}

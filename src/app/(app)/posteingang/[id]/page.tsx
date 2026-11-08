import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit, kontaktName } from "@/lib/format";
import { berlinTag, tagPlus } from "@/lib/zeit";
import { emailLaden } from "@/lib/dienste/mail";
import { nameAusAbsender } from "@/lib/dienste/crm";
import { FachFehler } from "@/lib/dienste/fehler";
import { AktionsFormular } from "@/components/aktions-formular";
import { zuordnenAktion, ignorierenAktion, anfrageAktion, aufgabeAktion } from "../actions";

export default async function EmailSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht();
  const id = (await params).id;
  const m = await emailLaden(b, id).catch((e) => (e instanceof FachFehler ? null : Promise.reject(e)));
  if (!m) notFound();
  if (!m.gelesen) await db.email.update({ where: { id: m.id }, data: { gelesen: true } });

  const buero = b.rolle !== "KOLONNE";
  const [kontakt, projekt, projekte, mitarbeiter, verlauf] = await Promise.all([
    m.kontaktId ? db.kontakt.findUnique({ where: { id: m.kontaktId } }) : null,
    m.projektId ? db.projekt.findUnique({ where: { id: m.projektId } }) : null,
    db.projekt.findMany({ where: { firmaId: b.mandant.id, status: { abgeschlossen: false } }, include: { kontakt: true }, orderBy: { updatedAt: "desc" }, take: 300 }),
    db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: b.mandant.id } } }, orderBy: { name: "asc" } }),
    m.konversation ? db.email.findMany({ where: { firmaId: m.firmaId, konversation: m.konversation, id: { not: m.id } }, orderBy: { empfangenAm: "asc" } }) : [],
  ]);
  const name = nameAusAbsender(m.vonName);
  const morgen = tagPlus(berlinTag(new Date()), 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <Link href="/posteingang" className="text-sm text-marke">← Posteingang</Link>
          <h1 className="h1 break-words">{m.betreff}</h1>
          <div className="text-sm text-slate-600">
            {m.richtung === "EINGANG" ? <>Von <b>{m.vonName ?? ""}</b> &lt;{m.vonAdresse}&gt;</> : <>Von {m.vonAdresse}</>} · an {m.an.join(", ")}
            {m.cc.length > 0 && <> · Cc {m.cc.join(", ")}</>} · {datumZeit(m.empfangenAm)}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href={`/posteingang/schreiben?antwort=${m.id}`} className="btn">Antworten</Link>
          {m.webLink && <a href={m.webLink} target="_blank" rel="noreferrer" className="btn-hell">In Outlook öffnen</a>}
          <form action={ignorierenAktion}>
            <input type="hidden" name="id" value={m.id} />{m.ignoriert && <input type="hidden" name="wieder" value="1" />}
            <button className="btn-hell">{m.ignoriert ? "Wieder einblenden" : "Ausblenden"}</button>
          </form>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="karte min-w-0">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{m.text || m.vorschau}</pre>
          {m.hatAnhaenge && <p className="mt-3 text-xs text-slate-500">Diese Mail hat Anhänge – in Outlook öffnen, um sie anzusehen.</p>}
        </section>

        <aside className="space-y-4">
          <section className="karte space-y-2 text-sm">
            <h2 className="font-semibold">Zuordnung</h2>
            {kontakt ? <div>Kontakt: <Link href={`/kontakte/${kontakt.id}`} className="text-marke">{kontaktName(kontakt)}</Link></div> : <div className="text-slate-500">Kein Kontakt zugeordnet.</div>}
            {projekt && <div>Projekt: <Link href={`/projekte/${projekt.id}`} className="text-marke">{projekt.nummer} {projekt.titel}</Link></div>}
            {buero && (
              <form action={zuordnenAktion} className="space-y-2">
                <input type="hidden" name="id" value={m.id} />
                <select name="projektId" defaultValue={m.projektId ?? ""} className="eingabe">
                  <option value="">– Projekt wählen –</option>
                  {projekte.map((p) => <option key={p.id} value={p.id}>{p.nummer} {p.titel} ({kontaktName(p.kontakt)})</option>)}
                </select>
                <button className="btn-hell w-full justify-center">Zuordnen</button>
              </form>
            )}
          </section>

          {buero && !m.projektId && m.richtung === "EINGANG" && (
            <details className="karte text-sm" open={!m.kontaktId}>
              <summary className="cursor-pointer font-semibold">Als neue Anfrage anlegen</summary>
              <p className="mt-2 text-xs text-slate-500">Legt Kontakt (falls neu), Projekt und Wiedervorlage an und ordnet die Mail zu.</p>
              <AktionsFormular aktion={anfrageAktion} knopf="Anfrage anlegen" className="mt-3 grid gap-2">
                <input type="hidden" name="emailId" value={m.id} />
                <input type="hidden" name="email" value={m.vonAdresse} />
                <div className="grid grid-cols-2 gap-2">
                  <input name="vorname" defaultValue={name.vorname} placeholder="Vorname" className="eingabe" />
                  <input name="nachname" defaultValue={name.nachname} placeholder="Nachname" className="eingabe" />
                </div>
                <input name="firmenname" placeholder="Firma (optional)" className="eingabe" />
                <input name="telefon" placeholder="Telefon" className="eingabe" />
                <input name="titel" required defaultValue={m.betreff.replace(/^((AW|RE|WG|FW|Fwd):\s*)+/i, "")} placeholder="Titel des Projekts" className="eingabe" />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-500">Wiedervorlage<input type="date" name="wiedervorlageTag" defaultValue={morgen} className="eingabe" /></label>
                  <label className="text-xs text-slate-500">Zuständig
                    <select name="zustaendigId" defaultValue={b.id} className="eingabe">{mitarbeiter.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  </label>
                </div>
              </AktionsFormular>
            </details>
          )}

          {buero && (
            <details className="karte text-sm">
              <summary className="cursor-pointer font-semibold">Aufgabe zu dieser Mail</summary>
              <AktionsFormular aktion={aufgabeAktion} knopf="Aufgabe anlegen" zuruecksetzen className="mt-3 grid gap-2">
                <input type="hidden" name="emailId" value={m.id} />
                {m.projektId && <input type="hidden" name="projektId" value={m.projektId} />}
                {m.kontaktId && <input type="hidden" name="kontaktId" value={m.kontaktId} />}
                <input name="titel" required defaultValue={`Rückmeldung: ${m.betreff}`} className="eingabe" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" name="faelligTag" defaultValue={morgen} className="eingabe" />
                  <select name="zustaendigId" defaultValue={b.id} className="eingabe">{mitarbeiter.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                </div>
              </AktionsFormular>
            </details>
          )}

          {verlauf.length > 0 && (
            <section className="karte text-sm">
              <h2 className="mb-2 font-semibold">Verlauf</h2>
              <ul className="space-y-1">
                {verlauf.map((v) => (
                  <li key={v.id}><Link href={`/posteingang/${v.id}`} className="text-marke">{datumZeit(v.empfangenAm)}</Link> {v.richtung === "AUSGANG" ? "→" : "←"} {v.betreff}</li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

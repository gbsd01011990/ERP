import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { euro, datum, datumZeit, kontaktName } from "@/lib/format";
import { logbuchEintragen, projektStatusSetzen } from "../../actions";
import { angebotAnlegen } from "../../angebote/actions";
import { nachkalkulation } from "@/lib/nachkalkulation";
import { AufgabenListe, aufgabeInclude } from "@/components/aufgaben-liste";
import { AufgabeFormular } from "@/components/aufgabe-formular";
import { AktionsFormular } from "@/components/aktions-formular";
import { lvImportAktion } from "../../angebote/gaeb-actions";
import { RechnungNeu } from "@/components/rechnung-neu";
import { ART_TITEL, STATUS_TEXT } from "@/lib/faktura/texte";

const ART_TEXT = { NOTIZ: "Notiz", ANRUF: "Anruf", EMAIL: "E-Mail", TERMIN: "Termin", STATUS: "Status", SYSTEM: "System" } as const;

export default async function ProjektSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht();
  const { id } = await params;
  const p = await db.projekt.findUnique({
    where: { id },
    include: {
      firma: true,
      typ: true,
      status: true,
      verantwortlich: true,
      kontakt: { include: { adressen: true } },
      logbuch: { orderBy: { createdAt: "desc" }, include: { benutzer: { select: { name: true } } } },
      angebote: { orderBy: [{ createdAt: "asc" }] },
      rechnungen: { orderBy: [{ createdAt: "asc" }], omit: { pdf: true } },
    },
  });
  if (!p || !firmenIds(b).includes(p.firmaId)) notFound();
  const buero = b.rolle !== "KOLONNE";
  const [alleStatus, nk, aufgaben, mails, mitarbeiter] = await Promise.all([
    db.pipelineStatus.findMany({ where: { firmaId: p.firmaId }, orderBy: { reihenfolge: "asc" } }),
    nachkalkulation(p.id),
    db.aufgabe.findMany({ where: { projektId: p.id, erledigtAm: null }, include: aufgabeInclude, orderBy: [{ faelligAm: { sort: "asc", nulls: "last" } }] }),
    buero ? db.email.findMany({ where: { projektId: p.id }, orderBy: { empfangenAm: "desc" }, take: 30 }) : [],
    db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: p.firmaId } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const abweichung = (soll: number, ist: number) =>
    soll > 0 ? <span className={ist > soll ? "text-red-700" : "text-emerald-700"}>{ist > soll ? "+" : ""}{Math.round(((ist - soll) / soll) * 100)} %</span> : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500">{p.firma.name} · {p.nummer}{p.typ ? ` · ${p.typ.name}` : ""}</div>
          <h1 className="h1">{p.titel}</h1>
        </div>
        <form key={p.statusId} action={projektStatusSetzen} className="ml-auto flex gap-2">
          <input type="hidden" name="projektId" value={p.id} />
          <select name="statusId" defaultValue={p.statusId} className="eingabe w-auto">
            {alleStatus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn-hell">Status setzen</button>
        </form>
      </div>

      {/* Pipeline-Fortschritt */}
      <ol className="flex flex-wrap gap-1 text-xs">
        {alleStatus.filter((s) => !s.verloren).map((s) => (
          <li key={s.id} className="rounded px-2 py-1" style={s.reihenfolge <= p.status.reihenfolge ? { background: s.farbe, color: "white" } : { background: "#e2e8f0" }}>{s.name}</li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Kunde</h2>
          <Link href={`/kontakte/${p.kontakt.id}`} className="font-medium text-marke">{kontaktName(p.kontakt)}</Link>
          {p.kontakt.telefon && <div>Tel. <a href={`tel:${p.kontakt.telefon}`}>{p.kontakt.telefon}</a></div>}
          {p.kontakt.mobil && <div>Mobil <a href={`tel:${p.kontakt.mobil}`}>{p.kontakt.mobil}</a></div>}
          {p.kontakt.email && <div><a href={`mailto:${p.kontakt.email}`}>{p.kontakt.email}</a></div>}
          <h2 className="pt-2 font-semibold">Baustelle</h2>
          <div>{[p.baustelleStrasse, [p.baustellePlz, p.baustelleOrt].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "–"}</div>
          {(p.baustelleOrt || p.baustelleStrasse) && (
            <a className="text-marke" target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.baustelleStrasse, p.baustellePlz, p.baustelleOrt].filter(Boolean).join(" "))}`}>Route öffnen</a>
          )}
        </section>
        <section className="karte space-y-1 text-sm">
          <h2 className="mb-1 font-semibold">Eckdaten</h2>
          <div>Volumen: {euro(p.volumen)}</div>
          <div>Quelle: {p.quelle ?? "–"}</div>
          <div>Verantwortlich: {p.verantwortlich?.name ?? "–"}</div>
          <div>Angelegt: {datum(p.createdAt)}</div>
          {p.heroId && <div className="text-slate-400">HERO-ID {p.heroId}</div>}
          {p.beschreibung && <p className="whitespace-pre-line pt-2">{p.beschreibung}</p>}
        </section>
        <section className="karte space-y-2 text-sm">
          <div className="flex items-center">
            <h2 className="font-semibold">Dokumente</h2>
            {b.rolle !== "KOLONNE" && (
              <form action={angebotAnlegen} className="ml-auto">
                <input type="hidden" name="projektId" value={p.id} />
                <button className="btn-hell py-1">+ Angebot</button>
              </form>
            )}
          </div>
          {p.angebote.map((a) => (
            <Link key={a.id} href={`/angebote/${a.id}`} className="flex gap-2 rounded px-1 py-1 hover:bg-slate-50">
              <span className="font-medium text-marke">{a.art === "ANGEBOT" ? "Angebot" : "AB"} {a.nummer}{a.version > 1 ? `-${a.version}` : ""}</span>
              <span className="text-slate-500">{({ ENTWURF: "Entwurf", VERSENDET: "versendet", ANGENOMMEN: "angenommen", ABGELEHNT: "abgelehnt", ERSETZT: "ersetzt" } as const)[a.status]}</span>
              <span className="ml-auto">{euro(a.netto)}</span>
            </Link>
          ))}
          {p.angebote.length === 0 && <p className="text-slate-500">Noch keine Angebote.</p>}
          {buero && (
            <details className="pt-2">
              <summary className="cursor-pointer text-marke">GAEB-Datei importieren</summary>
              <p className="mt-1 text-xs text-slate-500">Ausschreibung (X80–X83, D83, P83), Auftrag (X86) oder Angebot (X84/X85). Daraus entsteht ein Angebot bzw. eine Auftragsbestätigung mit allen Positionen.</p>
              <AktionsFormular aktion={lvImportAktion} knopf="Importieren" knopfKlasse="btn-hell py-1" encType="multipart/form-data" className="mt-2 grid gap-2">
                <input type="hidden" name="projektId" value={p.id} />
                <input type="file" name="datei" required accept=".x80,.x81,.x82,.x83,.x84,.x85,.x86,.x52,.d81,.d83,.d84,.d86,.p81,.p83,.p84,.p86,.xml" className="text-sm" />
              </AktionsFormular>
            </details>
          )}
        </section>
      </div>

      {buero && (
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Rechnungen</h2>
          <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <div>
              {p.rechnungen.map((r) => (
                <Link key={r.id} href={`/rechnungen/${r.id}`} className="flex flex-wrap gap-2 rounded px-1 py-1 hover:bg-slate-50">
                  <span className="font-medium text-marke">{r.art === "ABSCHLAG" && r.abschlagNr ? `${r.abschlagNr}. Abschlag` : ART_TITEL[r.art]} {r.nummer ?? ""}</span>
                  <span className="text-slate-500">{STATUS_TEXT[r.status]}{r.nummer ? ` · ${datum(r.datum)}` : ""}</span>
                  <span className="ml-auto">{r.status === "ENTWURF" ? "" : euro(r.brutto)}</span>
                </Link>
              ))}
              {p.rechnungen.length === 0 && <p className="text-slate-500">Noch keine Rechnungen.</p>}
            </div>
            <RechnungNeu
              projektId={p.id}
              angebote={p.angebote.filter((a) => a.status !== "ERSETZT" && a.status !== "ABGELEHNT").map((a) => ({
                id: a.id, text: `${a.art === "ANGEBOT" ? "Angebot" : "AB"} ${a.nummer}${a.version > 1 ? `-${a.version}` : ""} · ${euro(a.netto)} netto`,
              }))}
            />
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="karte space-y-3">
          <h2 className="font-semibold">Aufgaben und Wiedervorlagen</h2>
          <AufgabenListe aufgaben={aufgaben} bezugZeigen={false} />
          {buero && <AufgabeFormular mitarbeiter={mitarbeiter} ichId={b.id} projektId={p.id} />}
        </section>
        {buero && (
          <section className="karte space-y-2 text-sm">
            <div className="flex items-center">
              <h2 className="font-semibold">E-Mails</h2>
              <Link href={`/posteingang/schreiben?projekt=${p.id}`} className="btn-hell ml-auto py-1">E-Mail schreiben</Link>
            </div>
            <ul className="divide-y divide-slate-100">
              {mails.map((m) => (
                <li key={m.id}>
                  <Link href={`/posteingang/${m.id}`} className="flex gap-3 py-1.5 hover:bg-slate-50">
                    <span className="w-24 shrink-0 text-slate-400">{datumZeit(m.empfangenAm)}</span>
                    <span className="w-4 shrink-0 text-slate-400" title={m.richtung === "AUSGANG" ? "gesendet" : "empfangen"}>{m.richtung === "AUSGANG" ? "→" : "←"}</span>
                    <span className={`min-w-0 flex-1 truncate ${m.gelesen ? "" : "font-semibold"}`}>{m.betreff}</span>
                  </Link>
                </li>
              ))}
              {mails.length === 0 && <li className="py-1 text-slate-500">Noch keine E-Mails zu diesem Projekt.</li>}
            </ul>
          </section>
        )}
      </div>

      {(nk.soll || nk.entnahmen.length > 0 || nk.einsaetze.length > 0 || nk.istLohnStunden > 0) && (
        <section className="karte overflow-x-auto text-sm">
          <h2 className="mb-1 font-semibold">Nachkalkulation</h2>
          <p className="mb-3 text-xs text-slate-500">
            {nk.basis ? `Soll aus ${nk.basis.art === "ANGEBOT" ? "Angebot" : "Auftragsbestätigung"} ${nk.basis.nummer}${nk.basis.version > 1 ? `-${nk.basis.version}` : ""}` : "Noch kein Angebot als Soll"}
            {" · Ist aus Zeiterfassung, Lagerentnahmen und Geräteeinsätzen."}
          </p>
          <table className="tabelle max-w-2xl">
            <thead><tr><th>Kostenart</th><th className="text-right">Soll</th><th className="text-right">Ist</th><th className="text-right">Abweichung</th></tr></thead>
            <tbody>
              <tr><td>Material (EK)</td><td className="text-right">{euro(nk.soll?.materialEk ?? 0)}</td><td className="text-right">{euro(nk.istMaterial)}</td><td className="text-right">{abweichung(nk.soll?.materialEk ?? 0, nk.istMaterial)}</td></tr>
              <tr><td>Geräte</td><td className="text-right">{euro(nk.soll?.geraete ?? 0)}</td><td className="text-right">{euro(nk.istGeraete)} <span className="text-xs text-slate-500">({nk.istGeraeteStunden.toLocaleString("de-DE")} h)</span></td><td className="text-right">{abweichung(nk.soll?.geraete ?? 0, nk.istGeraete)}</td></tr>
              <tr>
                <td>Lohnstunden</td>
                <td className="text-right">{(nk.soll?.stunden ?? 0).toLocaleString("de-DE")} h</td>
                <td className="text-right">{nk.istLohnStunden.toLocaleString("de-DE")} h</td>
                <td className="text-right">{abweichung(nk.soll?.stunden ?? 0, nk.istLohnStunden)}</td>
              </tr>
              {nk.istLohn != null && (
                <tr className="text-slate-500">
                  <td className="pl-6">Lohn zum Kalkulationssatz</td>
                  <td className="text-right">{euro(nk.soll?.lohnanteilNetto ?? 0)}</td>
                  <td className="text-right">{euro(nk.istLohn)}</td>
                  <td />
                </tr>
              )}
              <tr><td>Fremdleistung (EK)</td><td className="text-right">{euro(nk.soll?.fremdEk ?? 0)}</td><td className="text-right text-slate-400">folgt</td><td /></tr>
            </tbody>
          </table>
          {nk.lohnJeMitarbeiter.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">Stunden je Mitarbeiter: {nk.lohnJeMitarbeiter.map((m) => `${m.name} ${m.stunden.toLocaleString("de-DE")} h`).join(" · ")}</p>
          )}
          {(nk.entnahmen.length > 0 || nk.einsaetze.length > 0) && (
            <details className="mt-3">
              <summary className="cursor-pointer text-marke">Einzelbuchungen</summary>
              <ul className="mt-2 divide-y divide-slate-100">
                {nk.entnahmen.map((e) => <li key={e.id} className="flex gap-3 py-1"><span className="w-24 text-slate-400">{datum(e.createdAt)}</span><span className="flex-1">{e.menge.toString().replace(".", ",")} {e.artikel.einheit} {e.artikel.bezeichnung}</span><span>{euro(e.wert)}</span></li>)}
                {nk.einsaetze.map((e) => <li key={e.id} className="flex gap-3 py-1"><span className="w-24 text-slate-400">{datum(e.datum)}</span><span className="flex-1">{e.stunden.toString().replace(".", ",")} h {e.geraet.bezeichnung}</span><span>{euro(Number(e.stunden) * Number(e.kostensatz))}</span></li>)}
              </ul>
            </details>
          )}
        </section>
      )}

      <section className="karte">
        <h2 className="mb-3 font-semibold">Logbuch</h2>
        <form action={logbuchEintragen} className="mb-4 flex flex-wrap gap-2">
          <input type="hidden" name="projektId" value={p.id} />
          <select name="art" className="eingabe w-auto">
            {(["NOTIZ", "ANRUF", "EMAIL", "TERMIN"] as const).map((a) => <option key={a} value={a}>{ART_TEXT[a]}</option>)}
          </select>
          <input name="text" required placeholder="Eintrag …" className="eingabe min-w-0 flex-1" />
          <button className="btn">Speichern</button>
        </form>
        <ul className="divide-y divide-slate-100 text-sm">
          {p.logbuch.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-x-3 py-2">
              <span className="w-28 shrink-0 text-slate-400">{datumZeit(l.createdAt)}</span>
              <span className="w-16 shrink-0 text-xs uppercase text-slate-500">{ART_TEXT[l.art]}</span>
              <span className="flex-1 whitespace-pre-line">{l.text}</span>
              <span className="text-slate-400">{l.benutzer?.name}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

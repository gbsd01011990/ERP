import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { n } from "@/lib/kalkulation";
import { datum, euro } from "@/lib/format";
import { isoTag } from "@/lib/formular";
import { maschinensatz, pruefAmpel } from "@/lib/rechnung/geraete";
import { AMPEL, EREIGNIS, KATEGORIE, PRUEFART, STATUS } from "@/lib/geraete-texte";
import { GeraetFormular } from "../geraet-formular";
import { EinsatzFormular } from "../einsatz-formular";
import { pruefungSpeichernAktion, pruefungErledigtAktion, ereignisAktion, einsatzLoeschenAktion } from "../actions";

const zahl = (v: unknown, s = 1) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: s }).format(n(v as number));

export default async function GeraetSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht();
  const g = await db.geraet.findUnique({
    where: { id: (await params).id },
    include: {
      firma: true, lager: true,
      pruefungen: { orderBy: { naechsteAm: "asc" } },
      ereignisse: { orderBy: { datum: "desc" }, take: 100, include: { benutzer: { select: { name: true } } } },
      einsaetze: { orderBy: { datum: "desc" }, take: 100, include: { projekt: true } },
    },
  });
  if (!g || !firmenIds(b).includes(g.firmaId)) notFound();
  const [lager, projekte, sum] = await Promise.all([
    db.lager.findMany({ where: { firmaId: g.firmaId, aktiv: true }, orderBy: { name: "asc" } }),
    db.projekt.findMany({ where: { firmaId: g.firmaId, status: { abgeschlossen: false } }, orderBy: { nummer: "desc" }, take: 300 }),
    db.geraetEinsatz.aggregate({ where: { geraetId: g.id, datum: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)) } }, _sum: { stunden: true } }),
  ]);
  const satz = maschinensatz(g);
  const buero = b.rolle !== "KOLONNE";
  const heute = isoTag(new Date());
  const reparaturJahr = g.ereignisse.filter((e) => e.datum.getUTCFullYear() === new Date().getUTCFullYear()).reduce((s, e) => s + n(e.kosten), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500"><Link href={`/geraete?firma=${g.firmaId}`} className="text-marke">Geräte {g.firma.name}</Link> · {g.inventarNr} · {KATEGORIE[g.kategorie]}</div>
          <h1 className="h1">{g.bezeichnung}</h1>
          <div className="mt-1 flex flex-wrap gap-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[g.status][1]}`}>{STATUS[g.status][0]}</span>
            <span className="text-slate-500">{[g.hersteller, g.modell, g.kennzeichen, g.lager?.name].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Verrechnungssatz", satz.wirksam ? `${euro(satz.wirksam)} / h` : "–"],
          ["Kalkulierter Satz", satz.kalkuliert ? `${euro(satz.kalkuliert)} / h` : "Daten fehlen"],
          ["Betriebsstunden", g.betriebsstunden != null ? `${zahl(g.betriebsstunden)} h` : "–"],
          ["Einsatz dieses Jahr", `${zahl(sum._sum.stunden)} h`],
          ["Reparaturen dieses Jahr", euro(reparaturJahr)],
        ].map(([l, w]) => <div key={l} className="karte py-3"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{w}</div></div>)}
      </section>

      {satz.kalkuliert != null && (
        <p className="text-xs text-slate-500">
          Jahreskosten {euro(satz.jahreskosten)}: Abschreibung {euro(satz.afa)} + Zins {euro(satz.zins)} + Reparatur {euro(satz.reparatur)} + Fixkosten {euro(satz.fix)},
          geteilt durch {zahl(g.einsatzstundenJahr, 0)} Einsatzstunden, plus {euro(g.betriebskostenStd)} Betriebskosten je Stunde.
          {g.verrechnungssatz != null && " Für Einsätze gilt der feste Satz."}
        </p>
      )}

      {/* Prüfungen */}
      <section className="karte overflow-x-auto p-0">
        <h2 className="px-4 pt-4 font-semibold">Prüfungen und Wartung</h2>
        <table className="tabelle">
          <thead><tr><th>Art</th><th>Intervall</th><th>Zuletzt</th><th>Fällig</th><th>Erledigt am</th></tr></thead>
          <tbody>
            {g.pruefungen.map((p) => {
              const ampel = pruefAmpel(p.naechsteAm);
              return (
                <tr key={p.id}>
                  <td>{p.bezeichnung ?? PRUEFART[p.art]}</td>
                  <td>{p.intervallMonate ? `${p.intervallMonate} Monate` : "–"}</td>
                  <td>{p.letzteAm ? datum(p.letzteAm) : "–"}</td>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs ${AMPEL[ampel][1]}`}>{p.naechsteAm ? datum(p.naechsteAm) : AMPEL[ampel][0]}</span></td>
                  <td>
                    <form action={pruefungErledigtAktion} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="geraetId" value={g.id} />
                      <input type="date" name="am" defaultValue={heute} className="eingabe w-36 py-1" aria-label="Erledigt am" />
                      <input name="bemerkung" placeholder="Bemerkung" className="eingabe w-40 py-1" />
                      <input name="kosten" placeholder="Kosten €" inputMode="decimal" className="eingabe w-24 py-1" />
                      <button className="btn-hell py-1">Erledigt</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {g.pruefungen.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500">Keine Prüfungen hinterlegt.</td></tr>}
          </tbody>
        </table>
        {buero && (
          <form action={pruefungSpeichernAktion} className="grid gap-2 border-t border-slate-200 p-4 md:grid-cols-6">
            <input type="hidden" name="geraetId" value={g.id} />
            <div>
              <label className="label">Art</label>
              <select name="art" className="eingabe">{Object.entries(PRUEFART).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div><label className="label">Bezeichnung</label><input name="bezeichnung" placeholder="optional" className="eingabe" /></div>
            <div><label className="label">Intervall Monate</label><input name="intervallMonate" inputMode="numeric" placeholder="12" className="eingabe" /></div>
            <div><label className="label">Zuletzt am</label><input type="date" name="letzteAm" className="eingabe" /></div>
            <div><label className="label">oder fällig am</label><input type="date" name="naechsteAm" className="eingabe" /></div>
            <div className="flex items-end"><button className="btn">+ Prüfung</button></div>
          </form>
        )}
      </section>

      {/* Einsätze */}
      <section className="karte space-y-3">
        <h2 className="font-semibold">Einsätze auf Projekten</h2>
        <EinsatzFormular geraetId={g.id} heute={heute} projekte={projekte.map((p) => ({ id: p.id, text: `${p.nummer} ${p.titel}` }))} />
        <table className="tabelle">
          <thead><tr><th>Datum</th><th>Projekt</th><th className="text-right">Stunden</th><th className="text-right">Satz</th><th className="text-right">Kosten</th><th>Notiz</th><th /></tr></thead>
          <tbody>
            {g.einsaetze.map((e) => (
              <tr key={e.id}>
                <td>{datum(e.datum)}</td>
                <td><Link href={`/projekte/${e.projektId}`} className="text-marke">{e.projekt.nummer}</Link> {e.projekt.titel}</td>
                <td className="text-right">{zahl(e.stunden, 2)}</td>
                <td className="text-right">{euro(e.kostensatz)}</td>
                <td className="text-right">{euro(n(e.stunden) * n(e.kostensatz))}</td>
                <td>{e.notiz}</td>
                <td className="text-right">{buero && <form action={einsatzLoeschenAktion}><input type="hidden" name="id" value={e.id} /><button className="text-xs text-red-600" aria-label="Einsatz löschen">✕</button></form>}</td>
              </tr>
            ))}
            {g.einsaetze.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-slate-500">Noch keine Einsätze.</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Historie */}
      <section className="karte space-y-3">
        <h2 className="font-semibold">Historie: Reparaturen, Schäden, Wartung</h2>
        <form action={ereignisAktion} className="grid gap-2 md:grid-cols-7">
          <input type="hidden" name="geraetId" value={g.id} />
          <div>
            <label className="label">Art</label>
            <select name="art" defaultValue="REPARATUR" className="eingabe">{Object.entries(EREIGNIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div><label className="label">Datum</label><input type="date" name="datum" defaultValue={heute} className="eingabe" /></div>
          <div className="md:col-span-2"><label className="label">Beschreibung</label><input name="text" required className="eingabe" /></div>
          <div><label className="label">Kosten €</label><input name="kosten" inputMode="decimal" className="eingabe" /></div>
          <div><label className="label">Betriebsstd.</label><input name="betriebsstunden" inputMode="decimal" className="eingabe" /></div>
          <div>
            <label className="label">Status setzen</label>
            <select name="status" defaultValue="" className="eingabe"><option value="">unverändert</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
          </div>
          <div className="md:col-span-7"><button className="btn-hell">Eintragen</button></div>
        </form>
        <ul className="divide-y divide-slate-100 text-sm">
          {g.ereignisse.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 py-2">
              <span className="w-24 shrink-0 text-slate-400">{datum(e.datum)}</span>
              <span className="w-24 shrink-0 text-xs uppercase text-slate-500">{EREIGNIS[e.art]}</span>
              <span className="flex-1">{e.text}</span>
              {e.kosten != null && <span>{euro(e.kosten)}</span>}
              <span className="text-slate-400">{e.benutzer?.name}</span>
            </li>
          ))}
          {g.ereignisse.length === 0 && <li className="py-2 text-slate-500">Noch keine Einträge.</li>}
        </ul>
      </section>

      {buero && (
        <details className="karte">
          <summary className="cursor-pointer font-semibold">Stammdaten und Kalkulation bearbeiten</summary>
          <div className="mt-4"><GeraetFormular firmaId={g.firmaId} g={g} lager={lager} /></div>
        </details>
      )}
    </div>
  );
}

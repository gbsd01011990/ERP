import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { n } from "@/lib/kalkulation";
import { planErgebnis } from "@/lib/rechnung/plankosten";
import { datumZeit, euro } from "@/lib/format";
import { planSpeichernAktion, zeileSpeichernAktion, zeileLoeschenAktion, uebernehmenAktion } from "../actions";

const zahl = (v: unknown, s = 2) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: s }).format(n(v as number));
const VERTEILUNG = { LOHN: "auf Lohnstunden", MATERIAL: "auf Material", FREMD: "auf Fremdleistung" } as const;

export default async function PlanSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht(["ADMIN"]);
  const p = await db.kostenplan.findUnique({ where: { id: (await params).id }, include: { firma: true, zeilen: { orderBy: { reihenfolge: "asc" } } } });
  if (!p || !firmenIds(b).includes(p.firmaId)) notFound();
  const r = planErgebnis(p, p.zeilen);
  const f = p.firma;
  const feld = (name: keyof typeof p & string, label: string, hilfe?: string) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={zahl(p[name])} inputMode="decimal" className="eingabe" />
      {hilfe && <p className="mt-1 text-xs text-slate-500">{hilfe}</p>}
    </div>
  );
  const gruppen = [...new Set(p.zeilen.map((z) => z.gruppe))];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-slate-500"><Link href="/plankosten" className="text-marke">Plankostenrechnung</Link> · {f.name}</div>
        <h1 className="h1">{p.bezeichnung ?? `Plan ${p.jahr}`}</h1>
      </div>

      {/* Ergebnis */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Stundenverrechnungssatz", r.stundensatz ? euro(r.stundensatz) : "–", `aktuell in der Firma: ${euro(f.stundensatz)}`],
          ["Zuschlag Material", `${zahl(r.materialAufschlag)} %`, `aktuell: ${zahl(f.materialAufschlag)} %`],
          ["Zuschlag Fremdleistung", `${zahl(r.fremdAufschlag)} %`, `aktuell: ${zahl(f.fremdAufschlag)} %`],
          ["Planergebnis", euro(r.planergebnis), `Umsatz ${euro(r.planumsatz)} − Kosten ${euro(r.plankosten)}`],
        ].map(([l, w, h]) => (
          <div key={l} className="karte py-3"><div className="text-xs text-slate-500">{l}</div><div className="text-xl font-semibold">{w}</div><div className="text-xs text-slate-500">{h}</div></div>
        ))}
      </section>
      <section className="karte text-sm">
        <h2 className="mb-2 font-semibold">So entsteht der Stundensatz</h2>
        <dl className="grid max-w-xl grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt>Bezahlte Stunden</dt><dd className="text-right">{zahl(r.bezahlteStunden, 0)} h</dd>
          <dt>Produktive Stunden</dt><dd className="text-right">{zahl(r.produktiveStunden, 0)} h</dd>
          <dt>Lohnkosten inkl. Nebenkosten</dt><dd className="text-right">{euro(r.lohnkosten)}</dd>
          <dt>Lohn je produktive Stunde</dt><dd className="text-right">{euro(r.lohnJeStd)}</dd>
          <dt>+ Gemeinkosten je produktive Stunde</dt><dd className="text-right">{euro(r.gkJeStd)}</dd>
          <dt>= Selbstkosten je Stunde</dt><dd className="text-right">{euro(r.selbstkostenJeStd)}</dd>
          <dt>+ Wagnis und Gewinn {zahl(p.wagnisGewinnProzent)} %</dt><dd className="text-right font-semibold">{r.stundensatz ? euro(r.stundensatz) : "–"}</dd>
        </dl>
        <form action={uebernehmenAktion} className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={p.id} />
          <button className="btn" disabled={!r.stundensatz}>Sätze in {f.name} übernehmen</button>
          <span className="text-xs text-slate-500">{p.uebernommenAm ? `Zuletzt übernommen am ${datumZeit(p.uebernommenAm)}.` : "Noch nicht übernommen."} Gilt für neue Angebote.</span>
        </form>
      </section>

      {/* Eingaben */}
      <form action={planSpeichernAktion} className="karte space-y-4">
        <input type="hidden" name="id" value={p.id} />
        <h2 className="font-semibold">Personal und Einsatz</h2>
        <div className="grid gap-3 md:grid-cols-4">
          {feld("mitarbeiter", "Gewerbliche Mitarbeiter", "Vollzeit-Äquivalente auf der Baustelle")}
          {feld("bezahlteStundenJahr", "Bezahlte Stunden je MA", "inkl. Urlaub, Krankheit, Feiertage")}
          {feld("produktivProzent", "Produktiv %", "auf Baustellen abrechenbar")}
          {feld("mittellohn", "Mittellohn €/h", "Durchschnitt der Kolonne, brutto")}
          {feld("lohnnebenkostenProzent", "Lohnnebenkosten %", "Sozialversicherung, Urlaubskasse, BG, Lohnfortzahlung")}
          {feld("materialEinsatzJahr", "Materialeinsatz € / Jahr", "geplanter Einkauf zu EK")}
          {feld("fremdEinsatzJahr", "Fremdleistung € / Jahr", "Subunternehmer, Entsorgung")}
          {feld("wagnisGewinnProzent", "Wagnis und Gewinn %")}
        </div>
        <button className="btn">Eingaben speichern</button>
      </form>

      {/* Gemeinkosten */}
      <section className="karte overflow-x-auto p-0">
        <div className="flex flex-wrap items-baseline gap-3 px-4 pt-4">
          <h2 className="font-semibold">Gemeinkosten je Jahr</h2>
          <span className="text-sm text-slate-500">Summe {euro(r.gemeinkosten.gesamt)}: Lohn {euro(r.gemeinkosten.lohn)}, Material {euro(r.gemeinkosten.material)}, Fremd {euro(r.gemeinkosten.fremd)}</span>
        </div>
        <p className="px-4 pt-1 text-xs text-slate-500">Maschinen und Fahrzeuge, die über einen eigenen Stundensatz auf Projekte gebucht werden, gehören nicht hierher.</p>
        <table className="tabelle mt-2">
          <thead><tr><th>Gruppe</th><th>Bezeichnung</th><th className="text-right">€ / Jahr</th><th>Verteilung</th><th /></tr></thead>
          <tbody>
            {p.zeilen.map((z) => (
              <tr key={z.id}>
                <td colSpan={5} className="p-0">
                  <form action={zeileSpeichernAktion} className="grid grid-cols-2 gap-2 px-3 py-1 md:grid-cols-[10rem_1fr_9rem_10rem_auto_auto]">
                    <input type="hidden" name="planId" value={p.id} /><input type="hidden" name="id" value={z.id} />
                    <input name="gruppe" defaultValue={z.gruppe} list="gruppen" className="eingabe py-1" aria-label="Gruppe" />
                    <input name="bezeichnung" defaultValue={z.bezeichnung} className="eingabe py-1" aria-label="Bezeichnung" />
                    <input name="betragJahr" defaultValue={zahl(z.betragJahr)} inputMode="decimal" className="eingabe py-1 text-right" aria-label="Betrag je Jahr" />
                    <select name="verteilung" defaultValue={z.verteilung} className="eingabe py-1" aria-label="Verteilung">
                      {Object.entries(VERTEILUNG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button className="btn-hell py-1">Speichern</button>
                    <button formAction={zeileLoeschenAktion} className="py-1 text-xs text-red-600" aria-label="Zeile löschen">✕</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="gruppen">{gruppen.map((g) => <option key={g} value={g} />)}</datalist>
        <form action={zeileSpeichernAktion} className="grid grid-cols-2 gap-2 border-t border-slate-200 px-3 py-3 md:grid-cols-[10rem_1fr_9rem_10rem_auto]">
          <input type="hidden" name="planId" value={p.id} />
          <input name="gruppe" placeholder="Gruppe" list="gruppen" className="eingabe py-1" />
          <input name="bezeichnung" required placeholder="Neue Kostenposition" className="eingabe py-1" />
          <input name="betragJahr" placeholder="€ / Jahr" inputMode="decimal" className="eingabe py-1 text-right" />
          <select name="verteilung" className="eingabe py-1">{Object.entries(VERTEILUNG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn py-1">+ Zeile</button>
        </form>
      </section>
    </div>
  );
}

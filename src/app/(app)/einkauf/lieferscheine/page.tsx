import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { lieferscheinListe } from "@/lib/dienste/lieferscheine";
import { isoTag } from "@/lib/formular";
import { datum, euro, kontaktName } from "@/lib/format";
import { AktionsFormular } from "@/components/aktions-formular";
import { EinkaufNav } from "@/components/einkauf-nav";
import { FotoFeld } from "@/components/foto-feld";
import { lieferscheinNeuAktion } from "../actions";

const STATUS = { OFFEN: "offen", ABGERECHNET: "abgerechnet", STORNIERT: "storniert" } as const;

export default async function Lieferscheine({ searchParams }: { searchParams: Promise<{ status?: string; projekt?: string }> }) {
  const b = await benutzerPflicht();
  const sp = await searchParams;
  const buero = b.rolle !== "KOLONNE";
  const [liste, lieferanten, projekte] = await Promise.all([
    lieferscheinListe(b, { status: sp.status ?? null }),
    db.kontakt.findMany({ where: { typ: "LIEFERANT", geloescht: false }, orderBy: { firmenname: "asc" }, select: { id: true, firmenname: true, nachname: true, vorname: true } }),
    db.projekt.findMany({ where: { firmaId: b.mandant.id, status: { abgeschlossen: false } }, orderBy: { nummer: "desc" }, select: { id: true, nummer: true, titel: true }, take: 300 }),
  ]);
  const offen = liste.filter((l) => l.status === "OFFEN");
  const alt = offen.filter((l) => Date.now() - l.datum.getTime() > 45 * 864e5).length;
  return (
    <div className="space-y-4">
      <h1 className="h1">Lieferscheine</h1>
      <EinkaufNav aktiv="/einkauf/lieferscheine" buero={buero} />
      <section className="karte">
        <h2 className="mb-1 font-semibold">Lieferschein erfassen</h2>
        <p className="mb-3 text-sm text-slate-600">Kauf auf Lieferschein, etwa Kleinmaterial im Baustoffhandel: Foto machen, Händler und Projekt wählen, fertig. Den Preis nur eintragen, wenn er draufsteht. Alternativ das Foto an das Lieferschein-Postfach mailen.</p>
        <AktionsFormular aktion={lieferscheinNeuAktion} knopf="Lieferschein speichern" zuruecksetzen className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-4"><FotoFeld pflicht /></div>
          <div>
            <label className="label">Händler</label>
            <select name="lieferantId" className="eingabe"><option value="">– anderer (unten eintragen) –</option>{lieferanten.map((l) => <option key={l.id} value={l.id}>{kontaktName(l)}</option>)}</select>
          </div>
          <div><label className="label">anderer Händler</label><input name="lieferantName" placeholder="z. B. Hornbach Potsdam" className="eingabe" /></div>
          <div><label className="label">Projekt / Baustelle</label><select name="projektId" defaultValue={sp.projekt ?? ""} className="eingabe"><option value="">– Lager, Werkstatt, allgemein –</option>{projekte.map((p) => <option key={p.id} value={p.id}>{p.nummer} {p.titel}</option>)}</select></div>
          <div><label className="label">Datum</label><input type="date" name="datum" defaultValue={isoTag(new Date())} className="eingabe" /></div>
          <div><label className="label">Lieferschein-Nr.</label><input name="nummer" className="eingabe" /></div>
          <div><label className="label">Betrag netto € (falls drauf)</label><input name="betrag" inputMode="decimal" className="eingabe" /></div>
          <div className="md:col-span-2"><label className="label">Was wurde gekauft?</label><input name="notiz" placeholder="z. B. Schrauben, Kabelbinder, 2 Sack Zement" className="eingabe" /></div>
        </AktionsFormular>
      </section>
      <div className="flex flex-wrap gap-2 text-sm">
        {[["", "offen"], ["ABGERECHNET", "abgerechnet"], ["ALLE", "alle"]].map(([k, t]) => <Link key={k} href={k ? `/einkauf/lieferscheine?status=${k}` : "/einkauf/lieferscheine"} className={(sp.status ?? "") === k ? "btn" : "btn-hell"}>{t}</Link>)}
        {alt > 0 && <span className="self-center text-amber-700">{alt} offene Lieferscheine sind älter als 45 Tage – Rechnung beim Händler anfordern?</span>}
      </div>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Datum</th><th>Händler</th><th>Nr.</th><th>Projekt</th><th>Was</th><th>Status</th>{buero && <th className="text-right">netto</th>}</tr></thead>
          <tbody>
            {liste.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td><Link href={`/einkauf/lieferscheine/${l.id}`} className="font-medium text-marke">{datum(l.datum)}</Link></td>
                <td>{l.lieferant ? kontaktName(l.lieferant) : l.lieferantName ?? <span className="text-amber-700">unbekannt</span>}</td>
                <td>{l.nummer ?? ""}</td><td>{l.projekt?.nummer ?? ""}</td>
                <td className="max-w-xs truncate">{l.notiz ?? ""} <span className="text-xs text-slate-400">{l._count.dateien} Datei(en) · {l.erfasstVon?.name ?? l.quelle.toLowerCase()}</span></td>
                <td>{STATUS[l.status]}{l.eingangsrechnung ? <span className="block text-xs"><Link href={`/einkauf/rechnungen/${l.eingangsrechnung.id}`} className="text-marke">RE {l.eingangsrechnung.rechnungsnummer}</Link></span> : ""}</td>
                {buero && <td className="text-right">{l.betrag == null ? "–" : euro(l.betrag)}</td>}
              </tr>
            ))}
            {liste.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Keine Lieferscheine.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

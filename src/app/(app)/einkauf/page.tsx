import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { datum, euro, kontaktName } from "@/lib/format";
import { zahlungsfrist } from "@/lib/dienste/einkauf";
import type { Pruefergebnis } from "@/lib/einkauf/pruefung";
import { AktionsFormular } from "@/components/aktions-formular";
import { EinkaufNav } from "@/components/einkauf-nav";
import { hochladenAktion, bestellungNeuAktion } from "./actions";

import { E_STATUS, B_STATUS, AMPEL } from "@/lib/einkauf/texte";

export default async function Einkauf({ searchParams }: { searchParams: Promise<{ ansicht?: string; status?: string }> }) {
  const b = await benutzerPflicht();
  const sp = await searchParams;
  const buero = b.rolle !== "KOLONNE";
  const ansicht = sp.ansicht === "bestellungen" || !buero ? "bestellungen" : "rechnungen";

  if (ansicht === "bestellungen") {
    const [liste, lieferanten, projekte] = await Promise.all([
      db.bestellung.findMany({ where: { firmaId: b.mandant.id, ...(sp.status ? { status: sp.status as keyof typeof B_STATUS } : { status: { notIn: ["ABGESCHLOSSEN", "STORNIERT"] } }) }, include: { lieferant: true, projekt: { select: { nummer: true } } }, orderBy: { updatedAt: "desc" }, take: 300 }),
      db.kontakt.findMany({ where: { typ: "LIEFERANT", geloescht: false }, orderBy: { firmenname: "asc" }, select: { id: true, firmenname: true, nachname: true, vorname: true } }),
      db.projekt.findMany({ where: { firmaId: b.mandant.id, status: { abgeschlossen: false } }, orderBy: { nummer: "desc" }, select: { id: true, nummer: true, titel: true }, take: 300 }),
    ]);
    return (
      <div className="space-y-4">
        <h1 className="h1">Einkauf · Bestellungen</h1>
        <EinkaufNav aktiv="/einkauf?ansicht=bestellungen" buero={buero} />
        <section className="karte">
          <h2 className="mb-2 font-semibold">{buero ? "Neue Bestellung" : "Bestellanforderung"}</h2>
          <AktionsFormular aktion={bestellungNeuAktion} knopf="Anlegen" className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2"><label className="label">Was wird gebraucht?</label><input name="betreff" required placeholder="z. B. Splitt und Rasengitter für Einfahrt" className="eingabe" /></div>
            <div><label className="label">Lieferant</label><select name="lieferantId" className="eingabe"><option value="">– später –</option>{lieferanten.map((l) => <option key={l.id} value={l.id}>{kontaktName(l)}</option>)}</select></div>
            <div><label className="label">Projekt</label><select name="projektId" className="eingabe"><option value="">– Lager / ohne –</option>{projekte.map((p) => <option key={p.id} value={p.id}>{p.nummer} {p.titel}</option>)}</select></div>
          </AktionsFormular>
          <p className="mt-2 text-xs text-slate-500">Kolonnen legen Anforderungen an, das Büro ergänzt Lieferant und Preise und löst die Bestellung aus. Material aus einem Angebot übernimmst du direkt im Projekt.</p>
        </section>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/einkauf?ansicht=bestellungen" className={!sp.status ? "btn" : "btn-hell"}>Offen</Link>
          {Object.entries(B_STATUS).map(([k, v]) => <Link key={k} href={`/einkauf?ansicht=bestellungen&status=${k}`} className={sp.status === k ? "btn" : "btn-hell"}>{v}</Link>)}
        </div>
        <div className="karte overflow-x-auto p-0">
          <table className="tabelle">
            <thead><tr><th>Nr.</th><th>Betreff</th><th>Lieferant</th><th>Projekt</th><th>Status</th><th className="text-right">Netto</th></tr></thead>
            <tbody>
              {liste.map((x) => (
                <tr key={x.id} className="hover:bg-slate-50">
                  <td><Link href={`/einkauf/bestellungen/${x.id}`} className="font-medium text-marke">{x.nummer ?? "Anforderung"}</Link></td>
                  <td>{x.betreff}</td><td>{x.lieferant ? kontaktName(x.lieferant) : <span className="text-amber-700">fehlt</span>}</td>
                  <td>{x.projekt?.nummer ?? (x.lagerId ? "Lager" : "")}</td><td>{B_STATUS[x.status]}</td><td className="text-right">{euro(x.netto)}</td>
                </tr>
              ))}
              {liste.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">Keine Bestellungen.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const status = sp.status && sp.status in E_STATUS ? (sp.status as keyof typeof E_STATUS) : null;
  const [liste, anzahl] = await Promise.all([
    db.eingangsrechnung.findMany({
      where: { firmaId: b.mandant.id, ...(status ? { status } : { status: { in: ["NEU", "PRUEFUNG", "FREIGEGEBEN"] } }) },
      omit: { datei: true, xml: true, daten: true }, include: { lieferant: true, bestellung: { select: { nummer: true } }, projekt: { select: { nummer: true } } },
      orderBy: [{ status: "asc" }, { datum: "asc" }], take: 300,
    }),
    db.eingangsrechnung.groupBy({ by: ["status"], where: { firmaId: b.mandant.id }, _count: true }),
  ]);
  const zahl = (s: string) => anzahl.find((a) => a.status === s)?._count ?? 0;
  return (
    <div className="space-y-4">
      <h1 className="h1">Einkauf · Eingangsrechnungen</h1>
      <EinkaufNav aktiv="/einkauf" buero={buero} />
      <section className="karte space-y-2 text-sm">
        <h2 className="font-semibold">Rechnung erfassen</h2>
        <p className="text-slate-600">XRechnung (XML), ZUGFeRD-PDF oder normales PDF hochladen, auch mehrere auf einmal. E-Rechnungen liest und prüft das ERP selbst. Rechnungen an ein Postfach mit „Rechnungseingang“ (Einstellungen → Postfächer) kommen automatisch.</p>
        <AktionsFormular aktion={hochladenAktion} knopf="Hochladen" encType="multipart/form-data" zuruecksetzen className="flex flex-wrap items-center gap-2">
          <input type="file" name="datei" multiple accept=".xml,.pdf" required className="text-sm" />
        </AktionsFormular>
      </section>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/einkauf" className={!status ? "btn" : "btn-hell"}>Zu erledigen ({zahl("NEU") + zahl("PRUEFUNG") + zahl("FREIGEGEBEN")})</Link>
        {Object.entries(E_STATUS).map(([k, v]) => <Link key={k} href={`/einkauf?status=${k}`} className={status === k ? "btn" : "btn-hell"}>{v} ({zahl(k)})</Link>)}
      </div>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th /><th>Lieferant</th><th>Rechnung</th><th>Datum</th><th>Bestellung / Projekt</th><th>Status</th><th>zahlen bis</th><th className="text-right">Brutto</th></tr></thead>
          <tbody>
            {liste.map((r) => {
              const p = r.pruefung as unknown as Pruefergebnis | null;
              const f = zahlungsfrist(r);
              const bis = f.skonto && f.skonto.bis > new Date() ? f.skonto.bis : f.faellig;
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td><span title={p?.ergebnis ?? "nicht geprüft"} className={`inline-block h-3 w-3 rounded-full ${p ? AMPEL[p.ergebnis] : "bg-slate-300"}`} /></td>
                  <td>{r.lieferant ? kontaktName(r.lieferant) : r.lieferantName ?? <span className="text-amber-700">unbekannt</span>}</td>
                  <td><Link href={`/einkauf/rechnungen/${r.id}`} className="font-medium text-marke">{r.rechnungsnummer ?? r.dateiName}</Link> <span className="text-xs text-slate-400">{r.format === "PDF" ? "PDF" : "E-Rechnung"}</span></td>
                  <td>{r.datum ? datum(r.datum) : ""}</td>
                  <td>{r.bestellung?.nummer ?? ""}{r.projekt ? ` ${r.projekt.nummer}` : ""}</td>
                  <td>{E_STATUS[r.status]}</td>
                  <td className={bis && bis < new Date() && r.status !== "BEZAHLT" ? "text-red-700" : ""}>{bis ? datum(bis) : ""}{f.skonto && f.skonto.bis > new Date() ? " (Skonto)" : ""}</td>
                  <td className="text-right">{euro(r.brutto)}</td>
                </tr>
              );
            })}
            {liste.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-500">Keine Rechnungen.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

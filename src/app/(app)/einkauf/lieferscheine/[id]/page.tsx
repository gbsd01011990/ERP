import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { lieferscheinLaden } from "@/lib/dienste/lieferscheine";
import { n } from "@/lib/kalkulation";
import { isoTag } from "@/lib/formular";
import { datum, kontaktName } from "@/lib/format";
import { AktionsFormular } from "@/components/aktions-formular";
import { EinkaufNav } from "@/components/einkauf-nav";
import { FotoFeld } from "@/components/foto-feld";
import { lieferscheinBearbeitenAktion, lieferscheinStornoAktion } from "../../actions";

export default async function LieferscheinSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht();
  const l = await lieferscheinLaden(b, (await params).id).catch((e) => { if (e instanceof FachFehler) return null; throw e; });
  if (!l) notFound();
  const offen = l.status === "OFFEN";
  const [lieferanten, projekte] = await Promise.all([
    db.kontakt.findMany({ where: { geloescht: false, OR: [{ typ: "LIEFERANT" }, ...(l.lieferantId ? [{ id: l.lieferantId }] : [])] }, orderBy: { firmenname: "asc" }, select: { id: true, firmenname: true, nachname: true, vorname: true } }),
    db.projekt.findMany({ where: { firmaId: l.firmaId, OR: [{ status: { abgeschlossen: false } }, ...(l.projektId ? [{ id: l.projektId }] : [])] }, orderBy: { nummer: "desc" }, select: { id: true, nummer: true, titel: true }, take: 300 }),
  ]);
  return (
    <div className="space-y-4">
      <EinkaufNav aktiv="" buero={b.rolle !== "KOLONNE"} />
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500">Lieferschein · erfasst {l.quelle === "EMAIL" ? "per E-Mail" : l.quelle === "WARENEINGANG" ? "beim Wareneingang" : `von ${l.erfasstVon?.name ?? ""}`}</div>
          <h1 className="h1">{l.lieferant ? kontaktName(l.lieferant) : l.lieferantName ?? "Händler unbekannt"}{l.nummer ? ` · ${l.nummer}` : ""} · {datum(l.datum)}</h1>
          <div className="text-sm text-slate-500">
            {({ OFFEN: "offen, noch nicht abgerechnet", ABGERECHNET: "abgerechnet", STORNIERT: "storniert" } as const)[l.status]}
            {l.eingangsrechnung && <> · <Link href={`/einkauf/rechnungen/${l.eingangsrechnung.id}`} className="text-marke">Rechnung {l.eingangsrechnung.rechnungsnummer}</Link></>}
            {l.bestellung && <> · <Link href={`/einkauf/bestellungen/${l.bestellung.id}`} className="text-marke">Bestellung {l.bestellung.nummer}</Link></>}
            {l.projekt && <> · <Link href={`/projekte/${l.projekt.id}`} className="text-marke">{l.projekt.nummer} {l.projekt.titel}</Link></>}
          </div>
        </div>
        {offen && !l.eingangsrechnung && <form action={lieferscheinStornoAktion} className="ml-auto"><input type="hidden" name="id" value={l.id} /><button className="btn-hell text-red-600">Stornieren</button></form>}
      </div>
      <section className="grid gap-3 md:grid-cols-2">
        {l.dateien.map((d) => d.typ === "application/pdf"
          ? <iframe key={d.id} src={`/einkauf/lieferscheine/datei/${d.id}`} title={d.name} className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white" />
          : d.typ === "image/heic"
            ? <a key={d.id} href={`/einkauf/lieferscheine/datei/${d.id}`} className="karte text-sm text-marke">{d.name} (HEIC, herunterladen)</a>
            : <a key={d.id} href={`/einkauf/lieferscheine/datei/${d.id}`} target="_blank"><img src={`/einkauf/lieferscheine/datei/${d.id}`} alt={d.name} className="w-full rounded-lg border border-slate-200 bg-white" /></a>)}
        {l.dateien.length === 0 && <p className="karte text-sm text-slate-500">Kein Foto. Beim Wareneingang ohne Foto erfasst.</p>}
      </section>
      <section className="karte">
        <AktionsFormular aktion={lieferscheinBearbeitenAktion} knopf="Speichern" className="grid gap-3 md:grid-cols-4">
          <input type="hidden" name="id" value={l.id} />
          <fieldset disabled={!offen} className="contents">
            <div><label className="label">Händler</label><select name="lieferantId" defaultValue={l.lieferantId ?? ""} className="eingabe"><option value="">– anderer –</option>{lieferanten.map((k) => <option key={k.id} value={k.id}>{kontaktName(k)}</option>)}</select></div>
            <div><label className="label">anderer Händler</label><input name="lieferantName" defaultValue={l.lieferantName ?? ""} className="eingabe" /></div>
            <div><label className="label">Lieferschein-Nr.</label><input name="nummer" defaultValue={l.nummer ?? ""} className="eingabe" /></div>
            <div><label className="label">Datum</label><input type="date" name="datum" defaultValue={isoTag(l.datum)} className="eingabe" /></div>
            <div><label className="label">Projekt</label><select name="projektId" defaultValue={l.projektId ?? ""} className="eingabe"><option value="">– allgemein –</option>{projekte.map((p) => <option key={p.id} value={p.id}>{p.nummer} {p.titel}</option>)}</select></div>
            <div><label className="label">Betrag netto €</label><input name="betrag" defaultValue={l.betrag == null ? "" : String(n(l.betrag)).replace(".", ",")} className="eingabe" /></div>
            <div className="md:col-span-2"><label className="label">Was wurde gekauft?</label><input name="notiz" defaultValue={l.notiz ?? ""} className="eingabe" /></div>
            {offen && <div className="md:col-span-4"><span className="label">Weitere Seiten</span><FotoFeld /></div>}
          </fieldset>
        </AktionsFormular>
      </section>
    </div>
  );
}

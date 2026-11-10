import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { bestellungLaden } from "@/lib/dienste/einkauf";
import { buchhaltungAus } from "@/lib/faktura/op";
import { n } from "@/lib/kalkulation";
import { isoTag } from "@/lib/formular";
import { datum, euro, kontaktName } from "@/lib/format";
import { B_STATUS, E_STATUS } from "@/lib/einkauf/texte";
import { AktionsFormular } from "@/components/aktions-formular";
import { EinkaufNav } from "@/components/einkauf-nav";
import { FotoFeld } from "@/components/foto-feld";
import { bestellungKopfAktion, bestellPosNeuAktion, bestellPosAktion, bestellenAktion, bestellungStornoAktion, wareneingangAktion } from "../../actions";

const z3 = (v: unknown) => n(v as number).toLocaleString("de-DE", { maximumFractionDigits: 3 });

export default async function BestellungSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht();
  const x = await bestellungLaden(b, (await params).id).catch((e) => { if (e instanceof FachFehler) return null; throw e; });
  if (!x) notFound();
  const buero = b.rolle !== "KOLONNE";
  const offen = x.status === "ENTWURF";
  const [lieferanten, projekte, lager, artikel] = await Promise.all([
    db.kontakt.findMany({ where: { typ: "LIEFERANT", geloescht: false }, orderBy: { firmenname: "asc" }, select: { id: true, firmenname: true, nachname: true, vorname: true } }),
    db.projekt.findMany({ where: { firmaId: x.firmaId, status: { abgeschlossen: false } }, orderBy: { nummer: "desc" }, select: { id: true, nummer: true, titel: true }, take: 300 }),
    db.lager.findMany({ where: { firmaId: x.firmaId, aktiv: true }, orderBy: { name: "asc" } }),
    offen ? db.artikel.findMany({ where: { firmaId: x.firmaId, aktiv: true }, orderBy: { nummer: "asc" }, select: { id: true, nummer: true, bezeichnung: true } }) : [],
  ]);
  const limit = buchhaltungAus(x.firma.buchhaltung).bestellLimitBuero;
  const lieferbar = ["BESTELLT", "TEILGELIEFERT", "GELIEFERT"].includes(x.status);

  return (
    <div className="space-y-4">
      <EinkaufNav aktiv="" buero={buero} />
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500">{x.firma.name}{x.projekt && <> · <Link href={`/projekte/${x.projekt.id}`} className="text-marke">{x.projekt.nummer} {x.projekt.titel}</Link></>}</div>
          <h1 className="h1">{x.nummer ? `Bestellung ${x.nummer}` : "Bestellanforderung"}</h1>
          <div className="text-sm text-slate-500">{B_STATUS[x.status]} · {x.betreff} · angelegt von {x.erstelltVon?.name}{x.bestelltAm ? ` · bestellt ${datum(x.bestelltAm)} von ${x.bestelltVon?.name}` : ""}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {x.nummer && <a href={`/einkauf/bestellungen/${x.id}/pdf`} target="_blank" className="btn-hell">PDF</a>}
          {x.nummer && buero && x.lieferant?.email && <Link href={`/posteingang/schreiben?bestellung=${x.id}`} className="btn-hell">Per E-Mail senden</Link>}
          {buero && x.status !== "STORNIERT" && x.status !== "ABGESCHLOSSEN" && !x.wareneingaenge.length && !x.rechnungen.length && (
            <form action={bestellungStornoAktion}><input type="hidden" name="id" value={x.id} /><button className="btn-hell text-red-600">{offen ? "Anforderung löschen" : "Stornieren"}</button></form>
          )}
        </div>
      </div>

      <section className="karte">
        <AktionsFormular aktion={bestellungKopfAktion} knopf="Speichern" knopfKlasse="btn-hell" className="grid gap-3 md:grid-cols-4">
          <input type="hidden" name="id" value={x.id} />
          <fieldset disabled={!offen} className="contents">
            <div className="md:col-span-2"><label className="label">Betreff</label><input name="betreff" defaultValue={x.betreff} className="eingabe" /></div>
            <div><label className="label">Lieferant</label><select name="lieferantId" defaultValue={x.lieferantId ?? ""} className="eingabe"><option value="">– wählen –</option>{lieferanten.map((l) => <option key={l.id} value={l.id}>{kontaktName(l)}</option>)}</select></div>
            <div><label className="label">Liefertermin</label><input type="date" name="liefertermin" defaultValue={isoTag(x.liefertermin)} className="eingabe" /></div>
            <div><label className="label">Projekt</label><select name="projektId" defaultValue={x.projektId ?? ""} className="eingabe"><option value="">– ohne –</option>{projekte.map((p) => <option key={p.id} value={p.id}>{p.nummer} {p.titel}</option>)}</select></div>
            <div><label className="label">Ins Lager</label><select name="lagerId" defaultValue={x.lagerId ?? ""} className="eingabe"><option value="">– direkt auf die Baustelle –</option>{lager.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div className="md:col-span-2"><label className="label">Lieferadresse</label><input name="lieferadresse" defaultValue={x.lieferadresse ?? ""} className="eingabe" /></div>
            <div className="md:col-span-4"><label className="label">Hinweis an den Lieferanten</label><input name="notiz" defaultValue={x.notiz ?? ""} className="eingabe" /></div>
          </fieldset>
        </AktionsFormular>
        {!x.lieferant?.email && x.lieferantId && <p className="mt-2 text-xs text-amber-700">Beim Lieferanten ist keine E-Mail-Adresse hinterlegt; das PDF lässt sich trotzdem herunterladen.</p>}
      </section>

      {/* Positionen mit Abgleich */}
      <section className="karte overflow-x-auto p-0 text-sm">
        <table className="tabelle">
          <thead><tr><th>Pos.</th><th>Artikel / Text</th><th className="text-right">bestellt</th><th>Einh.</th><th className="text-right">EK netto</th><th className="text-right">geliefert</th><th className="text-right">berechnet</th><th className="text-right">Wert</th><th /></tr></thead>
          <tbody>
            {x.positionen.map((p, i) => {
              const fehltLieferung = !offen && n(p.geliefert) < n(p.menge);
              const mehrBerechnet = n(p.berechnet) > n(p.geliefert) + 1e-6;
              return (
                <tr key={p.id}>
                  <td>{i + 1}</td>
                  <td>{p.text}{p.artNr && <span className="block text-xs text-slate-500">Art.-Nr. {p.artNr}</span>}{p.artikel && <span className="block text-xs text-slate-500">Lagerartikel {p.artikel.nummer}</span>}</td>
                  <td className="text-right">{z3(p.menge)}</td><td>{p.einheit}</td><td className="text-right">{euro(p.preis)}</td>
                  <td className={`text-right ${fehltLieferung ? "text-amber-700" : ""}`}>{offen ? "" : z3(p.geliefert)}</td>
                  <td className={`text-right ${mehrBerechnet ? "text-red-700" : ""}`}>{offen ? "" : z3(p.berechnet)}</td>
                  <td className="text-right">{euro(n(p.menge) * n(p.preis))}</td>
                  <td>{offen && (
                    <AktionsFormular aktion={bestellPosAktion} knopf="✕" knopfKlasse="text-xs text-red-600">
                      <input type="hidden" name="id" value={x.id} /><input type="hidden" name="posId" value={p.id} /><input type="hidden" name="loeschen" value="1" />
                    </AktionsFormular>
                  )}</td>
                </tr>
              );
            })}
            {x.positionen.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-slate-500">Noch keine Positionen.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={7} className="text-right font-medium">Bestellwert netto</td><td className="text-right font-semibold">{euro(x.netto)}</td><td /></tr></tfoot>
        </table>
        {offen && (
          <div className="border-t border-slate-200 px-4 py-3">
            <AktionsFormular aktion={bestellPosNeuAktion} knopf="+ Position" zuruecksetzen className="grid gap-2 md:grid-cols-[12rem_1fr_7rem_6rem_5rem_7rem]">
              <input type="hidden" name="id" value={x.id} />
              <select name="artikelId" className="eingabe" aria-label="Lagerartikel"><option value="">– freie Position –</option>{artikel.map((a) => <option key={a.id} value={a.id}>{a.nummer} {a.bezeichnung}</option>)}</select>
              <input name="text" required placeholder="Bezeichnung" className="eingabe" aria-label="Bezeichnung" />
              <input name="artNr" placeholder="Art.-Nr. Lieferant" className="eingabe" aria-label="Artikelnummer" />
              <input name="menge" required placeholder="Menge" className="eingabe" aria-label="Menge" />
              <input name="einheit" placeholder="Einh." className="eingabe" aria-label="Einheit" />
              <input name="preis" placeholder="EK € netto" className="eingabe" aria-label="Preis" />
            </AktionsFormular>
          </div>
        )}
      </section>

      {offen && buero && (
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Bestellung auslösen</h2>
          <p className="text-slate-600">Vergibt die Bestellnummer. Danach geht die Bestellung als PDF per E-Mail oder Download an den Lieferanten. {b.rolle !== "ADMIN" && n(x.netto) > limit ? `Über ${euro(limit)} netto löst ein Admin aus.` : ""}</p>
          <AktionsFormular aktion={bestellenAktion} knopf="Jetzt bestellen"><input type="hidden" name="id" value={x.id} /></AktionsFormular>
        </section>
      )}

      {lieferbar && (
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Wareneingang buchen</h2>
          <p className="text-slate-600">Mengen laut Lieferschein. {x.lager ? `Lagerartikel gehen mit dem Bestellpreis ins Lager „${x.lager.name}“.` : "Ohne Lager gilt die Ware als direkt auf die Baustelle geliefert."}</p>
          <AktionsFormular aktion={wareneingangAktion} knopf="Wareneingang buchen" zuruecksetzen className="grid gap-2 md:grid-cols-4">
            <input type="hidden" name="id" value={x.id} />
            <div><label className="label">Datum</label><input type="date" name="datum" defaultValue={isoTag(new Date())} className="eingabe" /></div>
            <div><label className="label">Lieferschein-Nr.</label><input name="lieferschein" className="eingabe" /></div>
            <div className="md:col-span-2"><label className="label">Notiz (Mängel, Teillieferung …)</label><input name="notiz" className="eingabe" /></div>
            <div className="md:col-span-4"><span className="label">Lieferschein (Foto oder PDF)</span><FotoFeld /></div>
            {x.positionen.map((p) => {
              const rest = Math.max(0, n(p.menge) - n(p.geliefert));
              return (
                <label key={p.id} className="flex items-center gap-2 md:col-span-2">
                  <input name={`menge_${p.id}`} defaultValue={rest ? String(rest).replace(".", ",") : ""} className="eingabe w-24" aria-label={`Menge ${p.text}`} />
                  <span>{p.einheit} {p.text} <span className="text-xs text-slate-500">(offen {z3(rest)})</span></span>
                </label>
              );
            })}
          </AktionsFormular>
        </section>
      )}

      {(x.wareneingaenge.length > 0 || x.rechnungen.length > 0) && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="karte text-sm">
            <h2 className="mb-2 font-semibold">Lieferungen</h2>
            {x.wareneingaenge.map((w) => (
              <div key={w.id} className="border-b border-slate-100 py-1">
                {datum(w.datum)}{w.lieferschein ? ` · Lieferschein ${w.lieferschein}` : ""} · {w.benutzer?.name}
                {w.lieferscheine.map((l) => <Link key={l.id} href={`/einkauf/lieferscheine/${l.id}`} className="ml-2 text-marke">Lieferschein ansehen</Link>)}
                <span className="block text-xs text-slate-500">{w.positionen.map((wp) => { const p = x.positionen.find((q) => q.id === wp.bestellPositionId); return `${z3(wp.menge)} ${p?.einheit ?? ""} ${p?.text ?? ""}`; }).join(" · ")}{w.notiz ? ` · ${w.notiz}` : ""}</span>
              </div>
            ))}
          </div>
          <div className="karte text-sm">
            <h2 className="mb-2 font-semibold">Rechnungen</h2>
            {x.rechnungen.map((r) => (
              <Link key={r.id} href={`/einkauf/rechnungen/${r.id}`} className="flex gap-2 border-b border-slate-100 py-1 hover:bg-slate-50">
                <span className="font-medium text-marke">{r.rechnungsnummer ?? "ohne Nr."}</span><span>{r.datum ? datum(r.datum) : ""}</span><span className="text-slate-500">{E_STATUS[r.status]}</span><span className="ml-auto">{euro(r.brutto)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { eingangLaden, zahlungsfrist } from "@/lib/dienste/einkauf";
import { buchhaltungAus } from "@/lib/faktura/op";
import type { Pruefergebnis } from "@/lib/einkauf/pruefung";
import { n } from "@/lib/kalkulation";
import { isoTag } from "@/lib/formular";
import { datum, euro, kontaktName } from "@/lib/format";
import { E_STATUS, KOSTENART_TEXT, einheitText } from "@/lib/einkauf/texte";
import { AktionsFormular } from "@/components/aktions-formular";
import { EinkaufNav } from "@/components/einkauf-nav";
import { eingangKopfAktion, lieferantAnlegenAktion, freigebenAktion, freigabeZurueckAktion, ablehnenAktion, bezahltAktion, neuPruefenAktion } from "../../actions";

const FARBE = { ok: "text-emerald-700", hinweis: "text-slate-600", warnung: "text-amber-700", fehler: "text-red-700" } as const;
const ZEICHEN = { ok: "✓", hinweis: "i", warnung: "!", fehler: "✕" } as const;
const GRUPPE = { formal: "Formal (§ 14 UStG)", rechnerisch: "Rechnerisch", bestellung: "Bestellung und Lieferung", sicherheit: "Sicherheit" } as const;
const z3 = (v: unknown) => n(v as number).toLocaleString("de-DE", { maximumFractionDigits: 3 });

export default async function EingangSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const r = await eingangLaden(b, (await params).id).catch((e) => { if (e instanceof FachFehler) return null; throw e; });
  if (!r) notFound();
  const p = r.pruefung as unknown as Pruefergebnis | null;
  const offen = r.status === "NEU" || r.status === "PRUEFUNG";
  const manuell = r.format === "PDF";
  const firma = await db.firma.findUniqueOrThrow({ where: { id: r.firmaId } });
  const bh = buchhaltungAus(firma.buchhaltung);
  const [lieferanten, bestellungen, projekte] = await Promise.all([
    db.kontakt.findMany({ where: { geloescht: false, OR: [{ typ: "LIEFERANT" }, ...(r.lieferantId ? [{ id: r.lieferantId }] : [])] }, orderBy: { firmenname: "asc" }, select: { id: true, firmenname: true, nachname: true, vorname: true } }),
    db.bestellung.findMany({ where: { firmaId: r.firmaId, OR: [{ status: { in: ["BESTELLT", "TEILGELIEFERT", "GELIEFERT"] }, ...(r.lieferantId ? { lieferantId: r.lieferantId } : {}) }, ...(r.bestellungId ? [{ id: r.bestellungId }] : [])] }, include: { lieferant: true }, orderBy: { bestelltAm: "desc" }, take: 100 }),
    db.projekt.findMany({ where: { firmaId: r.firmaId, status: { abgeschlossen: false } }, orderBy: { nummer: "desc" }, select: { id: true, nummer: true, titel: true }, take: 300 }),
  ]);
  const f = zahlungsfrist(r);
  const fehler = p?.regeln.filter((x) => x.status === "fehler").length ?? 0;
  const mussAdmin = fehler > 0 || n(r.brutto) > bh.freigabeLimitBuero;

  return (
    <div className="space-y-4">
      <EinkaufNav aktiv="" buero />
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500">Eingangsrechnung · {r.format === "PDF" ? "PDF" : r.format === "ZUGFERD" ? "ZUGFeRD" : "XRechnung"} · {r.quelle === "EMAIL" ? `per E-Mail von ${r.email?.vonAdresse ?? ""}` : "hochgeladen"}</div>
          <h1 className="h1">{r.lieferant ? kontaktName(r.lieferant) : r.lieferantName ?? "Lieferant unbekannt"} · {r.rechnungsnummer ?? r.dateiName}</h1>
          <div className="text-sm text-slate-500">{E_STATUS[r.status]}{r.datum ? ` · vom ${datum(r.datum)}` : ""}{r.freigegebenAm ? ` · freigegeben ${datum(r.freigegebenAm)} von ${r.freigegebenVon?.name}` : ""}{r.bezahltAm ? ` · bezahlt ${datum(r.bezahltAm)}` : ""}</div>
        </div>
        <div className="ml-auto flex gap-2">
          <a href={`/einkauf/rechnungen/${r.id}/datei`} target="_blank" className="btn-hell">Original ({r.dateiName.split(".").pop()?.toUpperCase()})</a>
          {offen && <form action={neuPruefenAktion}><input type="hidden" name="id" value={r.id} /><button className="btn-hell">Neu prüfen</button></form>}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        {[["Netto", euro(r.netto)], ["Umsatzsteuer", r.steuerUmkehr ? "§ 13b (wir)" : euro(r.mwst)], ["Zahlbetrag", euro(r.zahlbetrag)],
          [f.skonto ? `Skonto ${n(r.skontoProzent)} % bis ${datum(f.skonto.bis)}` : "fällig", f.skonto ? euro(f.skonto.betrag) : f.faellig ? datum(f.faellig) : "–"]].map(([l, w]) => (
          <div key={l} className="karte py-3"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{w}</div></div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
        <div className="space-y-4">
          {r.positionen.length > 0 && (
            <section className="karte overflow-x-auto p-0 text-sm">
              <table className="tabelle">
                <thead><tr><th>Nr.</th><th>Leistung</th><th className="text-right">Menge</th><th className="text-right">Preis</th><th className="text-right">Gesamt</th><th>bestellt als</th></tr></thead>
                <tbody>
                  {r.positionen.map((x) => (
                    <tr key={x.id}>
                      <td>{x.nr}</td><td>{x.text}{x.artNr && <span className="block text-xs text-slate-500">Art.-Nr. {x.artNr}</span>}</td>
                      <td className="text-right">{z3(x.menge)} {einheitText(x.einheit)}</td><td className="text-right">{euro(x.preis)}</td><td className="text-right">{euro(x.gesamt)}</td>
                      <td className="text-xs">{x.bestellPosition ? <>{x.bestellPosition.text}<span className="block text-slate-500">{z3(x.bestellPosition.menge)} bestellt à {euro(x.bestellPosition.preis)}, {z3(x.bestellPosition.geliefert)} geliefert</span></> : r.bestellungId ? <span className="text-amber-700">nicht bestellt</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {r.format === "PDF" && (
            <section className="karte p-0">
              <iframe src={`/einkauf/rechnungen/${r.id}/datei`} title="Rechnung" className="h-[70vh] w-full rounded-lg" />
            </section>
          )}

          <section className="karte">
            <h2 className="mb-2 font-semibold">{manuell ? "Angaben aus dem PDF erfassen" : "Zuordnung"}</h2>
            <AktionsFormular aktion={eingangKopfAktion} knopf="Speichern und prüfen" knopfKlasse="btn-hell" className="grid gap-3 md:grid-cols-3">
              <input type="hidden" name="id" value={r.id} />
              <fieldset disabled={!offen && r.status !== "ABGELEHNT"} className="contents">
                <div><label className="label">Lieferant</label><select name="lieferantId" defaultValue={r.lieferantId ?? ""} className="eingabe"><option value="">– nicht zugeordnet –</option>{lieferanten.map((l) => <option key={l.id} value={l.id}>{kontaktName(l)}</option>)}</select></div>
                <div><label className="label">Bestellung</label><select name="bestellungId" defaultValue={r.bestellungId ?? ""} className="eingabe"><option value="">– ohne Bestellung –</option>{bestellungen.map((x) => <option key={x.id} value={x.id}>{x.nummer} {x.lieferant ? kontaktName(x.lieferant) : ""} · {x.betreff}</option>)}</select></div>
                <div><label className="label">Projekt (Nachkalkulation)</label><select name="projektId" defaultValue={r.projektId ?? ""} className="eingabe"><option value="">– Gemeinkosten –</option>{projekte.map((x) => <option key={x.id} value={x.id}>{x.nummer} {x.titel}</option>)}</select></div>
                <div><label className="label">Kostenart</label><select name="kostenart" defaultValue={r.kostenart} className="eingabe">{Object.entries(KOSTENART_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div><label className="label">Skonto %</label><input name="skontoProzent" defaultValue={n(r.skontoProzent) ? String(n(r.skontoProzent)).replace(".", ",") : ""} className="eingabe" /></div>
                <div><label className="label">Skonto Tage</label><input name="skontoTage" defaultValue={r.skontoTage || ""} className="eingabe" /></div>
                {manuell && (
                  <>
                    <div><label className="label">Rechnungsnummer</label><input name="rechnungsnummer" defaultValue={r.rechnungsnummer ?? ""} className="eingabe" /></div>
                    <div><label className="label">Rechnungsdatum</label><input type="date" name="datum" defaultValue={isoTag(r.datum)} className="eingabe" /></div>
                    <div><label className="label">fällig am</label><input type="date" name="faellig" defaultValue={isoTag(r.faellig)} className="eingabe" /></div>
                    <div><label className="label">Netto €</label><input name="netto" defaultValue={n(r.netto) ? String(n(r.netto)).replace(".", ",") : ""} className="eingabe" /></div>
                    <div><label className="label">USt. €</label><input name="mwst" defaultValue={n(r.mwst) ? String(n(r.mwst)).replace(".", ",") : ""} className="eingabe" /></div>
                    <div><label className="label">Brutto €</label><input name="brutto" defaultValue={n(r.brutto) ? String(n(r.brutto)).replace(".", ",") : ""} className="eingabe" /></div>
                    <div className="md:col-span-3"><label className="label">Leistungsdatum oder -zeitraum</label><input name="leistungsdatum" defaultValue={r.leistungsdatum ?? ""} className="eingabe" /></div>
                  </>
                )}
              </fieldset>
            </AktionsFormular>
            {!r.lieferantId && r.lieferantName && offen && (
              <AktionsFormular aktion={lieferantAnlegenAktion} knopf={`„${r.lieferantName}“ als Lieferant anlegen`} knopfKlasse="btn-hell mt-3"><input type="hidden" name="id" value={r.id} /></AktionsFormular>
            )}
            {r.notiz && <p className="mt-2 text-xs text-amber-700">{r.notiz}</p>}
          </section>
        </div>

        <div className="space-y-4">
          <section className="karte text-sm">
            <h2 className="mb-2 font-semibold">Prüfung {p && <span className={FARBE[p.ergebnis]}>{p.ergebnis === "ok" ? "bestanden" : p.ergebnis === "warnung" ? "mit Hinweisen" : "mit Fehlern"}</span>}</h2>
            {(Object.keys(GRUPPE) as (keyof typeof GRUPPE)[]).map((g) => {
              const regeln = p?.regeln.filter((x) => x.gruppe === g) ?? [];
              return regeln.length ? (
                <div key={g} className="mb-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{GRUPPE[g]}</div>
                  <ul>{regeln.map((x, i) => <li key={i} className={`flex gap-2 ${FARBE[x.status]}`}><span className="w-3 shrink-0 font-bold">{ZEICHEN[x.status]}</span><span>{x.text}</span></li>)}</ul>
                </div>
              ) : null;
            })}
          </section>

          {r.status === "PRUEFUNG" && (
            <section className="karte space-y-3 text-sm">
              <h2 className="font-semibold">Freigabe zur Zahlung</h2>
              {mussAdmin && <p className="text-amber-800">{fehler ? "Wegen der Fehler oben kann nur ein Admin freigeben, mit Begründung." : `Über ${euro(bh.freigabeLimitBuero)} brutto gibt ein Admin frei.`}</p>}
              <AktionsFormular aktion={freigebenAktion} knopf="Freigeben" className="space-y-2">
                <input type="hidden" name="id" value={r.id} />
                {fehler > 0 && <textarea name="begruendung" rows={2} placeholder="Begründung (z. B. mit Lieferant telefonisch geklärt)" className="eingabe" />}
              </AktionsFormular>
              <AktionsFormular aktion={ablehnenAktion} knopf="Ablehnen" knopfKlasse="btn-hell text-red-600" className="space-y-2">
                <input type="hidden" name="id" value={r.id} />
                <input name="grund" placeholder="Grund der Reklamation" className="eingabe" />
              </AktionsFormular>
            </section>
          )}
          {r.status === "NEU" && <section className="karte text-sm text-amber-800">Bitte Rechnungsnummer, Datum, Beträge und Lieferant erfassen. Danach läuft die Prüfung.</section>}
          {r.status === "ABGELEHNT" && <section className="karte text-sm text-red-700">Abgelehnt: {r.ablehnGrund}</section>}
          {r.status === "FREIGEGEBEN" && (
            <section className="karte space-y-2 text-sm">
              <h2 className="font-semibold">Zahlung</h2>
              {r.freigabeNotiz && <p className="text-slate-600">Freigabe-Begründung: {r.freigabeNotiz}</p>}
              <p className="text-slate-600">An {r.iban ?? "(IBAN aus der Rechnung)"}, Verwendungszweck {r.rechnungsnummer}. Den Zahlungsausgang erkennt auch der Kontoauszug-Abgleich.</p>
              <AktionsFormular aktion={bezahltAktion} knopf="Als bezahlt vermerken" className="grid grid-cols-2 gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input type="date" name="datum" defaultValue={isoTag(new Date())} className="eingabe" aria-label="Datum" />
                <input name="betrag" defaultValue={(f.skonto && f.skonto.bis >= new Date() ? n(r.zahlbetrag) - f.skonto.betrag : n(r.zahlbetrag)).toFixed(2).replace(".", ",")} className="eingabe" aria-label="Betrag" />
              </AktionsFormular>
              {b.rolle === "ADMIN" && <form action={freigabeZurueckAktion}><input type="hidden" name="id" value={r.id} /><button className="text-xs text-marke">Freigabe zurücknehmen</button></form>}
            </section>
          )}
          {r.bestellungId && <Link href={`/einkauf/bestellungen/${r.bestellungId}`} className="block text-sm text-marke">→ Bestellung öffnen</Link>}
        </div>
      </div>
    </div>
  );
}

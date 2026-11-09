import Link from "next/link";
import { benutzerPflicht } from "@/lib/auth";
import { offenePosten, buchhaltungLaden } from "@/lib/dienste/zahlungen";
import { OP_TEXT, MAHNSTUFE } from "@/lib/faktura/op";
import { ART_TITEL } from "@/lib/faktura/texte";
import { berlinTag } from "@/lib/zeit";
import { datum, euro, kontaktName } from "@/lib/format";
import { AktionsFormular } from "@/components/aktions-formular";
import { RechnungenNav } from "@/components/rechnungen-nav";
import { zahlungAktion, mahnenAktion } from "../zahlung-actions";

const FARBE = { ueberfaellig: "text-red-700", teilbezahlt: "text-amber-700", offen: "", erstatten: "text-sky-700", ausgeglichen: "text-slate-400" } as const;

export default async function OffenePosten({ searchParams }: { searchParams: Promise<{ alle?: string; nur?: string }> }) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const { alle, nur } = await searchParams;
  const [liste, bh] = await Promise.all([offenePosten(b, !!alle), buchhaltungLaden(b.mandant.id)]);
  const gezeigt = nur === "ueberfaellig" ? liste.filter((x) => x.status === "ueberfaellig") : liste;
  const summe = gezeigt.reduce((s, x) => s + x.offen, 0);
  const ueber = liste.filter((x) => x.status === "ueberfaellig").reduce((s, x) => s + x.offen, 0);
  const heute = berlinTag(new Date());
  return (
    <div className="space-y-4">
      <h1 className="h1">Offene Posten</h1>
      <RechnungenNav aktiv="/rechnungen/offene-posten" />
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="karte py-3"><div className="text-xs text-slate-500">Offen gesamt</div><div className="text-lg font-semibold">{euro(liste.reduce((s, x) => s + Math.max(0, x.offen), 0))}</div></div>
        <div className="karte py-3"><div className="text-xs text-slate-500">davon überfällig</div><div className="text-lg font-semibold text-red-700">{euro(ueber)}</div></div>
        <div className="karte py-3"><div className="text-xs text-slate-500">Einbehalte (Sicherheit)</div><div className="text-lg font-semibold">{euro(liste.reduce((s, x) => s + Number(x.r.einbehalt), 0))}</div></div>
      </section>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/rechnungen/offene-posten" className={!nur && !alle ? "btn" : "btn-hell"}>Offen</Link>
        <Link href="/rechnungen/offene-posten?nur=ueberfaellig" className={nur ? "btn" : "btn-hell"}>Überfällig</Link>
        <Link href="/rechnungen/offene-posten?alle=1" className={alle ? "btn" : "btn-hell"}>Mit bezahlten</Link>
      </div>
      <section className="karte p-0">
        <div className="hidden grid-cols-[7rem_1fr_6rem_6rem_7rem_7rem_8rem] gap-2 border-b border-slate-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid">
          <span>Nr.</span><span>Kunde</span><span>Datum</span><span>fällig</span><span className="text-right">Betrag</span><span className="text-right">offen</span><span>Stand</span>
        </div>
        {gezeigt.map(({ r, offen, status, faellig, tage, mahnstufe }) => (
          <details key={r.id} className="border-b border-slate-100">
            <summary className="grid cursor-pointer list-none grid-cols-2 gap-2 px-4 py-2 text-sm md:grid-cols-[7rem_1fr_6rem_6rem_7rem_7rem_8rem]">
              <span><Link href={`/rechnungen/${r.id}`} className="font-medium text-marke">{r.nummer}</Link></span>
              <span className="truncate">{kontaktName(r.projekt.kontakt)} <span className="text-xs text-slate-500">{ART_TITEL[r.art]}</span></span>
              <span>{datum(r.datum)}</span>
              <span>{datum(faellig)}</span>
              <span className="md:text-right">{euro(r.zahlbetrag)}</span>
              <span className="font-medium md:text-right">{euro(offen)}</span>
              <span className={`text-xs ${FARBE[status]}`}>{OP_TEXT[status]}{tage > 0 && status === "ueberfaellig" ? ` · ${tage} Tage` : ""}{mahnstufe ? ` · ${MAHNSTUFE[mahnstufe]}` : ""}</span>
            </summary>
            <div className="grid gap-4 bg-slate-50 px-4 py-3 text-sm lg:grid-cols-2">
              <div className="space-y-2">
                <div className="font-medium">Zahlung erfassen</div>
                <AktionsFormular aktion={zahlungAktion} knopf="Buchen" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <input type="hidden" name="rechnungId" value={r.id} />
                  <input type="date" name="datum" defaultValue={heute} className="eingabe" aria-label="Datum" />
                  <input name="betrag" defaultValue={offen > 0 ? offen.toFixed(2).replace(".", ",") : ""} className="eingabe" aria-label="Betrag" />
                  <select name="art" className="eingabe" aria-label="Art">
                    <option value="UEBERWEISUNG">Überweisung</option><option value="LASTSCHRIFT">Lastschrift</option><option value="BAR">bar</option>
                    <option value="SKONTO">Skonto</option><option value="AUSBUCHUNG">ausbuchen</option>
                  </select>
                  <input name="notiz" placeholder="Notiz" className="eingabe" aria-label="Notiz" />
                </AktionsFormular>
                {r.zahlungen.length > 0 && <div className="text-xs text-slate-500">Bisher: {r.zahlungen.map((z) => `${datum(z.datum)} ${euro(z.betrag)}`).join(" · ")}</div>}
              </div>
              {status === "ueberfaellig" && mahnstufe < 3 && (
                <div className="space-y-2">
                  <div className="font-medium">{MAHNSTUFE[mahnstufe + 1]} erstellen</div>
                  <AktionsFormular aktion={mahnenAktion} knopf={`${MAHNSTUFE[mahnstufe + 1]} als PDF`} knopfKlasse="btn-hell" className="space-y-1">
                    <input type="hidden" name="rechnungId" value={r.id} />
                    {mahnstufe >= 1 && <label className="flex items-center gap-2"><input type="checkbox" name="zinsen" disabled={bh.basiszins == null} /> Verzugszinsen berechnen{bh.basiszins == null ? " (Basiszins fehlt in den Einstellungen)" : ""}</label>}
                    {mahnstufe >= 1 && r.projekt.kontakt.kategorie !== "PRIVAT" && <label className="flex items-center gap-2"><input type="checkbox" name="pauschale" /> Verzugspauschale 40 € (nur Unternehmer)</label>}
                  </AktionsFormular>
                  <p className="text-xs text-slate-500">Frist {bh.mahnFristTage} Tage. Gebühren laut Einstellungen → Buchhaltung.</p>
                </div>
              )}
              {r.mahnungen.length > 0 && (
                <div className="text-xs lg:col-span-2">Mahnungen: {r.mahnungen.map((m) => <a key={m.id} href={`/rechnungen/mahnung/${m.id}`} target="_blank" className="mr-3 text-marke">{MAHNSTUFE[m.stufe]} vom {datum(m.datum)}</a>)}</div>
              )}
            </div>
          </details>
        ))}
        {gezeigt.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Keine offenen Posten.</p>}
        {gezeigt.length > 0 && <div className="flex justify-end border-t border-slate-200 px-4 py-2 text-sm">Summe offen: <b className="ml-2">{euro(summe)}</b></div>}
      </section>
    </div>
  );
}

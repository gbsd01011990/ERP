import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { ladeAngebot, angebotSummen } from "@/lib/angebot";
import { einzelpreisAnteile, n, nummerieren, wirksamerEp, runden, aufmassErgebnis } from "@/lib/kalkulation";
import { datum, euro, kontaktName } from "@/lib/format";
import {
  angebotKopfSpeichern, positionHinzufuegen, positionSpeichern, positionVerschieben, positionLoeschen,
  angebotVersendet, angebotAngenommen, angebotAbgelehnt, neueVersion, angebotLoeschen,
  aufmassHinzufuegen, aufmassLoeschen,
} from "../actions";

const STATUS = {
  ENTWURF: ["Entwurf", "bg-slate-200 text-slate-700"],
  VERSENDET: ["Versendet", "bg-amber-100 text-amber-800"],
  ANGENOMMEN: ["Angenommen", "bg-emerald-100 text-emerald-800"],
  ABGELEHNT: ["Abgelehnt", "bg-red-100 text-red-700"],
  ERSETZT: ["Ersetzt", "bg-slate-100 text-slate-500"],
} as const;

const zahl = (v: unknown, stellen = 2) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: stellen }).format(n(v as number));
const isoDatum = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function AngebotSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht();
  const a = await ladeAngebot((await params).id, b);
  if (!a) notFound();
  const leistungen = await db.leistung.findMany({ where: { firmaId: a.firmaId, aktiv: true }, orderBy: { nummer: "asc" } });
  const s = angebotSummen(a);
  const saetze = { stundensatz: a.stundensatz, materialAufschlag: a.materialAufschlag, fremdAufschlag: a.fremdAufschlag };
  const offen = a.status === "ENTWURF" && b.rolle !== "KOLONNE";
  const positionen = nummerieren(a.positionen);
  const titel = a.art === "ANGEBOT" ? "Angebot" : "Auftragsbestätigung";
  const nr = a.version > 1 ? `${a.nummer}-${a.version}` : a.nummer;
  const marge = s.netto - runden(s.lohnanteilNetto) - s.materialEk - s.fremdEk;

  return (
    <div className="space-y-4">
      {/* Kopfzeile */}
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500">
            {a.firma.name} · <Link href={`/projekte/${a.projektId}`} className="text-marke">{a.projekt.nummer} {a.projekt.titel}</Link>
          </div>
          <h1 className="h1">{titel} {nr}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span>
            <span className="text-slate-500">{kontaktName(a.projekt.kontakt)} · {datum(a.datum)}</span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <a href={`/angebote/${a.id}/pdf`} target="_blank" className="btn-hell">PDF ansehen</a>
          {b.rolle !== "KOLONNE" && <Link href={`/posteingang/schreiben?angebot=${a.id}`} className="btn-hell">Per E-Mail senden</Link>}
          {offen && <form action={angebotVersendet}><input type="hidden" name="id" value={a.id} /><button className="btn">Als versendet markieren</button></form>}
          {a.status === "VERSENDET" && a.art === "ANGEBOT" && (
            <>
              <form action={angebotAngenommen}><input type="hidden" name="id" value={a.id} /><button className="btn">Angenommen → Auftragsbestätigung</button></form>
              <form action={angebotAbgelehnt}><input type="hidden" name="id" value={a.id} /><button className="btn-hell">Abgelehnt</button></form>
            </>
          )}
          {a.status !== "ENTWURF" && a.status !== "ANGENOMMEN" && (
            <form action={neueVersion}><input type="hidden" name="id" value={a.id} /><button className="btn-hell">Neue Version</button></form>
          )}
          {offen && <form action={angebotLoeschen}><input type="hidden" name="id" value={a.id} /><button className="btn-hell text-red-600">Entwurf löschen</button></form>}
        </div>
      </div>

      {/* Summen */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Netto", euro(s.netto)],
          ["Brutto", euro(s.brutto)],
          ["Stunden", `${zahl(s.stunden, 1)} h`],
          ["Lohnanteil brutto (§ 35a)", euro(s.lohnanteilBrutto)],
          ["Deckungsbeitrag", euro(marge)],
        ].map(([l, w]) => (
          <div key={l} className="karte py-3"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{w}</div></div>
        ))}
      </section>

      {/* Kopfdaten */}
      <details className="karte" open={offen && a.positionen.length === 0}>
        <summary className="cursor-pointer font-semibold">Kopfdaten und Texte</summary>
        <form action={angebotKopfSpeichern} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={a.id} />
          <fieldset disabled={!offen} className="contents">
            <div className="sm:col-span-2"><label className="label">Betreff</label><input name="betreff" defaultValue={a.betreff} className="eingabe" /></div>
            <div><label className="label">Anrede</label><input name="anrede" defaultValue={a.anrede ?? ""} className="eingabe" /></div>
            {a.art === "ANGEBOT" && <div><label className="label">Gültig bis</label><input type="date" name="gueltigBis" defaultValue={isoDatum(a.gueltigBis)} className="eingabe" /></div>}
            <div className="sm:col-span-2"><label className="label">Einleitung</label><textarea name="einleitung" rows={3} defaultValue={a.einleitung ?? ""} className="eingabe" /></div>
            <div className="sm:col-span-2"><label className="label">Vorbemerkung (Absätze durch Leerzeile trennen)</label><textarea name="vorbemerkung" rows={4} defaultValue={a.vorbemerkung ?? ""} className="eingabe" /></div>
            <div className="sm:col-span-2"><label className="label">Schlusstext</label><textarea name="schlusstext" rows={2} defaultValue={a.schlusstext ?? ""} className="eingabe" /></div>
            <div><label className="label">Stundensatz €/h</label><input name="stundensatz" defaultValue={zahl(a.stundensatz)} className="eingabe" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Aufschlag Material %</label><input name="materialAufschlag" defaultValue={zahl(a.materialAufschlag)} className="eingabe" /></div>
              <div><label className="label">Aufschlag Fremd %</label><input name="fremdAufschlag" defaultValue={zahl(a.fremdAufschlag)} className="eingabe" /></div>
            </div>
            {offen && <div><button className="btn">Kopfdaten speichern</button></div>}
          </fieldset>
        </form>
      </details>

      {/* Positionen */}
      <section className="karte p-0">
        <div className="hidden grid-cols-[4rem_1fr_6rem_5rem_7rem_7rem_6rem] gap-2 border-b border-slate-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid">
          <span>Pos.</span><span>Leistung</span><span className="text-right">Menge</span><span>Einheit</span><span className="text-right">EP</span><span className="text-right">Gesamt</span><span />
        </div>
        {positionen.map((p, i) => {
          const anteile = einzelpreisAnteile(p, saetze);
          const ep = wirksamerEp(p, saetze);
          const gesamt = runden(ep * n(p.menge));
          const gruppe = p.art === "GRUPPE" ? s.gruppen.find((g) => g.index === i) : null;
          return (
            <details key={p.id} className={`border-b border-slate-100 ${p.art === "GRUPPE" ? "bg-marke-hell" : ""}`}>
              <summary className="grid cursor-pointer list-none grid-cols-[4rem_1fr] gap-2 px-4 py-2 text-sm md:grid-cols-[4rem_1fr_6rem_5rem_7rem_7rem_6rem]">
                <span className="text-slate-500">{p.posNr}</span>
                <span className={p.art === "GRUPPE" ? "font-semibold" : p.art === "TEXT" ? "italic text-slate-600" : ""}>
                  {p.kurztext}
                  {p.bedarf && <span className="ml-2 rounded bg-slate-200 px-1 text-xs">Bedarf</span>}
                  {p.preisFest && <span className="ml-2 rounded bg-amber-100 px-1 text-xs">Festpreis</span>}
                  {p.langtext && <span className="block truncate text-xs text-slate-500">{p.langtext}</span>}
                </span>
                {p.art === "POSITION" ? (
                  <>
                    <span className="col-start-2 md:col-start-auto md:text-right">{zahl(p.menge, 3)}</span>
                    <span>{p.einheit}</span>
                    <span className="md:text-right">{euro(ep)}</span>
                    <span className={`md:text-right ${p.bedarf ? "text-slate-400 line-through" : "font-medium"}`}>{euro(gesamt)}</span>
                  </>
                ) : gruppe ? (
                  <span className="col-start-2 font-semibold md:col-span-4 md:col-start-auto md:text-right">{euro(gruppe.summe)}</span>
                ) : <span className="hidden md:col-span-4 md:block" />}
                <span className="hidden text-right text-xs text-marke md:block">{offen ? "bearbeiten" : "Details"}</span>
              </summary>

              <div className="space-y-3 bg-slate-50 px-4 py-3">
                {/* key erzwingt neue Formularwerte, wenn sich Menge oder Preis serverseitig ändern */}
                <form key={`${p.menge}-${p.einzelpreis}-${p.aufmass.length}`} action={positionSpeichern} className="grid gap-3 md:grid-cols-6">
                  <input type="hidden" name="id" value={p.id} />
                  <fieldset disabled={!offen} className="contents">
                    <div className="md:col-span-6"><label className="label">Kurztext</label><input name="kurztext" defaultValue={p.kurztext} className="eingabe" /></div>
                    <div className="md:col-span-6"><label className="label">Langtext</label><textarea name="langtext" rows={3} defaultValue={p.langtext ?? ""} className="eingabe" /></div>
                    {p.art === "POSITION" && (
                      <>
                        <div>
                          <label className="label">Menge{p.aufmass.length ? " (aus Aufmaß)" : ""}</label>
                          <input name="menge" defaultValue={zahl(p.menge, 3)} readOnly={p.aufmass.length > 0} className={`eingabe ${p.aufmass.length ? "bg-slate-100" : ""}`} />
                        </div>
                        <div><label className="label">Einheit</label><input name="einheit" defaultValue={p.einheit} className="eingabe" /></div>
                        <div><label className="label">Lohn min/Einh.</label><input name="minuten" defaultValue={zahl(p.minuten)} className="eingabe" /></div>
                        <div><label className="label">Material EK €</label><input name="materialEk" defaultValue={zahl(p.materialEk)} className="eingabe" /></div>
                        <div><label className="label">Gerät €</label><input name="geraete" defaultValue={zahl(p.geraete)} className="eingabe" /></div>
                        <div><label className="label">Fremd EK €</label><input name="fremdEk" defaultValue={zahl(p.fremdEk)} className="eingabe" /></div>
                        <div className="md:col-span-2">
                          <label className="label">Fester Einzelpreis € (leer = kalkuliert)</label>
                          <input name="einzelpreis" defaultValue={p.preisFest ? zahl(p.einzelpreis) : ""} placeholder={zahl(anteile.summe)} className="eingabe" />
                        </div>
                        <label className="flex items-end gap-2 pb-2 text-sm md:col-span-2"><input type="checkbox" name="bedarf" defaultChecked={p.bedarf} /> Bedarfsposition (nicht in Summe)</label>
                        <div className="text-xs text-slate-500 md:col-span-6">
                          Kalkulation je Einheit: Lohn {euro(anteile.lohn)} + Material {euro(anteile.material)} + Gerät {euro(anteile.geraete)} + Fremd {euro(anteile.fremd)} = <b>{euro(anteile.summe)}</b>
                        </div>
                      </>
                    )}
                    {offen && <div className="md:col-span-6"><button className="btn">Speichern</button></div>}
                  </fieldset>
                </form>
                {p.art === "POSITION" && (p.aufmass.length > 0 || offen) && (
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Aufmaß</div>
                    <table className="w-full text-sm">
                      <thead className="text-xs text-slate-500">
                        <tr><th className="text-left font-normal">Bezeichnung</th><th className="text-right font-normal">Anz.</th><th className="text-right font-normal">Länge</th><th className="text-right font-normal">Breite</th><th className="text-right font-normal">Höhe</th><th className="text-right font-normal">Ergebnis</th><th /></tr>
                      </thead>
                      <tbody>
                        {p.aufmass.map((z) => (
                          <tr key={z.id} className={z.abzug ? "text-red-700" : ""}>
                            <td>{z.abzug ? "abzgl. " : ""}{z.text}</td>
                            {[z.anzahl, z.laenge, z.breite, z.hoehe].map((v, k) => <td key={k} className="text-right">{v == null ? "" : zahl(v, 3)}</td>)}
                            <td className="text-right font-medium">{zahl(aufmassErgebnis(z), 3)}</td>
                            <td className="text-right">
                              {offen && <form action={aufmassLoeschen}><input type="hidden" name="id" value={z.id} /><button className="text-xs text-red-600" aria-label="Zeile löschen">✕</button></form>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {offen && (
                      <form action={aufmassHinzufuegen} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_5rem_5rem_5rem_5rem_auto_auto]">
                        <input type="hidden" name="positionId" value={p.id} />
                        <input name="text" placeholder="z. B. Vorgarten links" className="eingabe col-span-2 sm:col-span-1" />
                        <input name="anzahl" placeholder="Anz." className="eingabe" />
                        <input name="laenge" placeholder="L" className="eingabe" />
                        <input name="breite" placeholder="B" className="eingabe" />
                        <input name="hoehe" placeholder="H" className="eingabe" />
                        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="abzug" /> Abzug</label>
                        <button className="btn-hell">+ Zeile</button>
                      </form>
                    )}
                  </div>
                )}
                {offen && (
                  <div className="flex gap-2">
                    {(["hoch", "runter"] as const).map((r) => (
                      <form key={r} action={positionVerschieben}>
                        <input type="hidden" name="id" value={p.id} /><input type="hidden" name="richtung" value={r} />
                        <button className="btn-hell">{r === "hoch" ? "↑ nach oben" : "↓ nach unten"}</button>
                      </form>
                    ))}
                    <form action={positionLoeschen} className="ml-auto"><input type="hidden" name="id" value={p.id} /><button className="btn-hell text-red-600">Löschen</button></form>
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {positionen.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Noch keine Positionen.</p>}

        {offen && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 px-4 py-3">
            <form action={positionHinzufuegen} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="angebotId" value={a.id} /><input type="hidden" name="art" value="POSITION" />
              <div>
                <label className="label">Aus Leistungsstamm</label>
                <select name="leistungId" className="eingabe w-72">
                  <option value="">– freie Position –</option>
                  {leistungen.map((l) => <option key={l.id} value={l.id}>{l.nummer} {l.kurztext}</option>)}
                </select>
              </div>
              <div><label className="label">Menge</label><input name="menge" defaultValue="1" className="eingabe w-24" /></div>
              <button className="btn">+ Position</button>
            </form>
            <form action={positionHinzufuegen}><input type="hidden" name="angebotId" value={a.id} /><input type="hidden" name="art" value="GRUPPE" /><button className="btn-hell">+ Titel</button></form>
            <form action={positionHinzufuegen}><input type="hidden" name="angebotId" value={a.id} /><input type="hidden" name="art" value="TEXT" /><button className="btn-hell">+ Hinweistext</button></form>
          </div>
        )}

        <div className="flex justify-end border-t border-slate-200 px-4 py-3 text-sm">
          <dl className="grid grid-cols-[auto_8rem] gap-x-6 gap-y-1">
            <dt>Summe netto</dt><dd className="text-right">{euro(s.netto)}</dd>
            <dt>zzgl. {zahl(a.mwstSatz)} % USt.</dt><dd className="text-right">{euro(s.mwst)}</dd>
            <dt className="font-semibold">Gesamt brutto</dt><dd className="text-right font-semibold">{euro(s.brutto)}</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}

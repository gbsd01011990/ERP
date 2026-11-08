import Link from "next/link";
import { notFound } from "next/navigation";
import { benutzerPflicht } from "@/lib/auth";
import { FachFehler } from "@/lib/dienste/fehler";
import { rechnungLaden, berechnung, verrechenbare, pruefen, empfaengerAus } from "@/lib/dienste/rechnungen";
import { aufmassZeileWert, beguenstigtJeEinheit, faelligAm, KOSTENARTEN } from "@/lib/faktura/berechnung";
import { ART_TITEL, STATUS_TEXT } from "@/lib/faktura/texte";
import { n, nummerieren } from "@/lib/kalkulation";
import { isoTag } from "@/lib/formular";
import { datum, euro, kontaktName } from "@/lib/format";
import { AktionsFormular } from "@/components/aktions-formular";
import {
  kopfAktion, positionNeuAktion, positionAktion, aufmassAktion, aufmassLoeschenAktion, verrechnungAktion,
  x31Aktion, festschreibenAktion, stornoAktion, entwurfLoeschenAktion, rechnungAnlegenAktion,
} from "../actions";

const STATUS_FARBE = { ENTWURF: "bg-slate-200 text-slate-700", FESTGESCHRIEBEN: "bg-emerald-100 text-emerald-800", STORNIERT: "bg-red-100 text-red-700" } as const;
const zahl = (v: unknown, stellen = 2) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: stellen }).format(n(v as number));

export default async function RechnungSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const r = await rechnungLaden(b, (await params).id).catch((e) => { if (e instanceof FachFehler) return null; throw e; });
  if (!r) notFound();
  const be = berechnung(r);
  const offen = r.status === "ENTWURF";
  const positionen = nummerieren(r.positionen);
  const titel = r.art === "ABSCHLAG" && r.abschlagNr ? `${r.abschlagNr}. ${ART_TITEL.ABSCHLAG}` : ART_TITEL[r.art];
  const maengel = offen ? pruefen(r, be) : [];
  const kandidaten = ["ABSCHLAG", "TEILSCHLUSS", "SCHLUSS"].includes(r.art) && offen ? await verrechenbare(r) : [];
  const gewaehlt = new Set(r.verrechnungen.map((v) => v.vorId));
  const emp = empfaengerAus(r);
  const hatAufmass = r.positionen.some((p) => p.aufmass.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500">
            {r.firma.name} · <Link href={`/projekte/${r.projektId}`} className="text-marke">{r.projekt.nummer} {r.projekt.titel}</Link>
            {r.angebot && <> · <Link href={`/angebote/${r.angebot.id}`} className="text-marke">{r.angebot.art === "ANGEBOT" ? "Angebot" : "AB"} {r.angebot.nummer}{r.angebot.version > 1 ? `-${r.angebot.version}` : ""}</Link></>}
            {r.bezug && <> · zu <Link href={`/rechnungen/${r.bezug.id}`} className="text-marke">{r.bezug.nummer}</Link></>}
          </div>
          <h1 className="h1">{titel} {r.nummer ?? "(Entwurf)"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_FARBE[r.status]}`}>{STATUS_TEXT[r.status]}</span>
            <span className="text-slate-500">{kontaktName(r.projekt.kontakt)} · {datum(r.datum)}</span>
            {r.festgeschriebenAm && <span className="text-slate-400">festgeschrieben {datum(r.festgeschriebenAm)} von {r.festgeschriebenVon?.name}</span>}
            {r.abschlagModus && <span className="text-slate-400">{r.abschlagModus === "PLAN" ? `nach Zahlungsplan ${zahl(r.planProzent)} %` : "nach Leistungsstand"}</span>}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <a href={`/rechnungen/${r.id}/pdf`} target="_blank" className="btn-hell">{offen ? "PDF-Vorschau" : "PDF"}</a>
          {hatAufmass && <a href={`/rechnungen/${r.id}/pdf?mengennachweis=1`} target="_blank" className="btn-hell">Mengennachweis</a>}
          {offen && <form action={entwurfLoeschenAktion}><input type="hidden" name="id" value={r.id} /><button className="btn-hell text-red-600">Entwurf löschen</button></form>}
        </div>
      </div>

      {/* Beträge */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [r.verrechnungen.length ? "Leistung gesamt netto" : "Netto", euro(be.leistung.netto)],
          ["Rechnungsbetrag brutto", euro(be.brutto)],
          [be.zahlbetrag < 0 ? "Erstattung" : "Zahlbetrag", euro(be.zahlbetrag)],
          ["§ 35a (Arbeit, Maschinen, Fahrt) brutto", r.s35a ? euro(be.lohnBrutto) : "nicht ausgewiesen"],
        ].map(([l, w]) => (
          <div key={l} className="karte py-3"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{w}</div></div>
        ))}
      </section>

      {/* Festschreiben, Storno, Korrektur */}
      {offen ? (
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Festschreiben</h2>
          {maengel.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-amber-800">{maengel.map((m) => <li key={m}>{m}</li>)}</ul>
          ) : (
            <p className="text-slate-600">Die Prüfliste ist erfüllt. Beim Festschreiben vergibt der Nummernkreis die nächste Rechnungsnummer, Beträge und Anschrift werden eingefroren und das PDF gespeichert. Danach lässt sich die Rechnung nur noch stornieren oder berichtigen.</p>
          )}
          <AktionsFormular aktion={festschreibenAktion} knopf="Festschreiben und Nummer vergeben">
            <input type="hidden" name="id" value={r.id} />
          </AktionsFormular>
        </section>
      ) : r.status === "FESTGESCHRIEBEN" && r.art !== "STORNO" ? (
        <section className="karte grid gap-4 text-sm md:grid-cols-2">
          <div className="space-y-2">
            <h2 className="font-semibold">Stornieren</h2>
            <p className="text-slate-600">Erzeugt eine Stornorechnung mit eigener Nummer und umgekehrten Beträgen. Die Rechnung bleibt im Archiv.</p>
            <AktionsFormular aktion={stornoAktion} knopf="Stornorechnung erzeugen" knopfKlasse="btn-hell text-red-600">
              <input type="hidden" name="id" value={r.id} />
              <label className="flex items-center gap-2"><input type="checkbox" name="bestaetigt" /> Ja, Rechnung {r.nummer} stornieren</label>
            </AktionsFormular>
          </div>
          <div className="space-y-2">
            <h2 className="font-semibold">Berichtigen</h2>
            <p className="text-slate-600">Eine Rechnungskorrektur erfasst nur die Differenz, etwa einen Nachlass oder eine falsche Menge. Negative Einzelpreise mindern den Betrag.</p>
            <AktionsFormular aktion={rechnungAnlegenAktion} knopf="Rechnungskorrektur anlegen" knopfKlasse="btn-hell">
              <input type="hidden" name="projektId" value={r.projektId} />
              <input type="hidden" name="art" value="KORREKTUR" />
              <input type="hidden" name="bezugId" value={r.id} />
            </AktionsFormular>
          </div>
        </section>
      ) : null}

      {/* Kopf */}
      <details className="karte" open={offen}>
        <summary className="cursor-pointer font-semibold">Kopfdaten, Steuer und Zahlung</summary>
        <div className="mt-2 text-sm text-slate-600">Empfänger: {emp.zeilen.join(", ")}{emp.kundennummer ? ` · Kd.-Nr. ${emp.kundennummer}` : ""}</div>
        <AktionsFormular aktion={kopfAktion} knopf="Kopfdaten speichern" className="mt-4 grid gap-4 sm:grid-cols-4">
          <input type="hidden" name="id" value={r.id} />
          <fieldset disabled={!offen} className="contents">
            <div><label className="label">Rechnungsdatum</label><input type="date" name="datum" required defaultValue={isoTag(r.datum)} className="eingabe" /></div>
            <div><label className="label">Leistung von</label><input type="date" name="leistungVon" defaultValue={isoTag(r.leistungVon)} className="eingabe" /></div>
            <div><label className="label">Leistung bis</label><input type="date" name="leistungBis" defaultValue={isoTag(r.leistungBis)} className="eingabe" /></div>
            <div><label className="label">Ihre Referenz / Leitweg-ID</label><input name="kundenReferenz" defaultValue={r.kundenReferenz ?? ""} className="eingabe" /></div>
            <div className="sm:col-span-4"><label className="label">Betreff</label><input name="betreff" defaultValue={r.betreff} className="eingabe" /></div>
            <div className="sm:col-span-2"><label className="label">Anrede</label><input name="anrede" defaultValue={r.anrede ?? ""} className="eingabe" /></div>
            <div className="sm:col-span-4"><label className="label">Einleitung</label><textarea name="einleitung" rows={2} defaultValue={r.einleitung ?? ""} className="eingabe" /></div>
            <div className="sm:col-span-4"><label className="label">Schlusstext</label><textarea name="schlusstext" rows={2} defaultValue={r.schlusstext ?? ""} className="eingabe" /></div>
            <div><label className="label">USt.-Satz %</label><input name="mwstSatz" defaultValue={zahl(r.mwstSatz)} className="eingabe" /></div>
            <div><label className="label">Zahlungsziel Tage (0 = sofort)</label><input name="zahlungszielTage" defaultValue={r.zahlungszielTage} className="eingabe" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Skonto %</label><input name="skontoProzent" defaultValue={zahl(r.skontoProzent)} className="eingabe" /></div>
              <div><label className="label">in Tagen</label><input name="skontoTage" defaultValue={r.skontoTage} className="eingabe" /></div>
            </div>
            <div><label className="label">Sicherheitseinbehalt %</label><input name="einbehaltProzent" defaultValue={zahl(r.einbehaltProzent)} className="eingabe" /></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="s35a" defaultChecked={r.s35a} /> Arbeitskosten nach § 35a EStG ausweisen (Privatkunden)</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="steuerschuldUmkehr" defaultChecked={r.steuerschuldUmkehr} /> Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" name="aufmassAnhang" defaultChecked={r.aufmassAnhang} /> Mengennachweis zur Rechnung mitgeben</label>
            <p className="text-xs text-slate-500 sm:col-span-4">
              {r.art === "ABSCHLAG" && "Ohne Leistungszeitraum gilt der Abschlag als Anzahlung vor Leistung; die Rechnung trägt dann den Hinweis zum Steuerzeitpunkt. "}
              Der Einbehalt gilt bei Abschlägen für den Betrag dieser Rechnung, bei Teilschluss- und Schlussrechnungen für die Gesamtleistung; dort werden Einbehalte aus verrechneten Abschlägen wieder fällig.
              {r.zahlungszielTage > 0 && ` Fällig am ${datum(faelligAm(r.datum, r.zahlungszielTage))}.`}
            </p>
          </fieldset>
        </AktionsFormular>
      </details>

      {/* Verrechnung */}
      {(kandidaten.length > 0 || r.verrechnungen.length > 0) && (
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Abzuziehende Rechnungen</h2>
          {offen ? (
            <AktionsFormular aktion={verrechnungAktion} knopf="Abzüge übernehmen" knopfKlasse="btn-hell" className="space-y-1">
              <input type="hidden" name="id" value={r.id} />
              {kandidaten.map((k) => (
                <label key={k.id} className="flex items-center gap-2">
                  <input type="checkbox" name="vorId" value={k.id} defaultChecked={gewaehlt.has(k.id)} />
                  {k.art === "ABSCHLAG" && k.abschlagNr ? `${k.abschlagNr}. Abschlagsrechnung` : ART_TITEL[k.art]} {k.nummer} vom {datum(k.datum)} · {euro(k.brutto)} brutto
                </label>
              ))}
            </AktionsFormular>
          ) : (
            <ul>{r.verrechnungen.map((v) => <li key={v.id}><Link href={`/rechnungen/${v.vorId}`} className="text-marke">{ART_TITEL[v.vor.art]} {v.vor.nummer}</Link> vom {datum(v.vor.datum)} · netto {euro(v.netto)} · USt. {euro(v.mwst)} · brutto {euro(v.brutto)}</li>)}</ul>
          )}
        </section>
      )}

      {/* Positionen */}
      <section className="karte p-0">
        <div className="hidden grid-cols-[4rem_1fr_7rem_5rem_7rem_6rem_7rem] gap-2 border-b border-slate-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid">
          <span>Pos.</span><span>Leistung</span><span className="text-right">Menge</span><span>Einheit</span><span className="text-right">EP</span><span>Kostenart</span><span className="text-right">Gesamt</span>
        </div>
        {positionen.map((p, i) => {
          const gesamt = be.zeilen[i]?.gesamt ?? 0;
          const gruppe = p.art === "GRUPPE" ? be.gruppen[positionen.slice(0, i).filter((x) => x.art === "GRUPPE").length] : null;
          return (
            <details key={p.id} className={`border-b border-slate-100 ${p.art === "GRUPPE" ? "bg-marke-hell" : ""}`}>
              <summary className="grid cursor-pointer list-none grid-cols-[4rem_1fr] gap-2 px-4 py-2 text-sm md:grid-cols-[4rem_1fr_7rem_5rem_7rem_6rem_7rem]">
                <span className="text-slate-500">{p.posNr}</span>
                <span style={{ paddingLeft: `${Math.max(0, p.ebene - 1) * 0.75}rem` }} className={p.art === "GRUPPE" ? "font-semibold" : p.art === "TEXT" ? "italic text-slate-600" : ""}>
                  {p.kurztext}
                  {p.aufmass.length > 0 && <span className="ml-2 rounded bg-sky-100 px-1 text-xs">Aufmaß {p.aufmass.length}</span>}
                  {p.auftragsMenge != null && p.art === "POSITION" && <span className="block text-xs text-slate-500">Auftrag {zahl(p.auftragsMenge, 3)} {p.einheit}</span>}
                </span>
                {p.art === "POSITION" ? (
                  <>
                    <span className="col-start-2 md:col-start-auto md:text-right">{zahl(p.menge, 3)}</span>
                    <span>{p.einheit}</span>
                    <span className="md:text-right">{euro(p.einzelpreis)}</span>
                    <span className="text-xs text-slate-500">{KOSTENARTEN.find((k) => k.wert === p.kostenart)?.text}{p.kostenart === "GEMISCHT" ? ` (${euro(beguenstigtJeEinheit(p))})` : ""}</span>
                    <span className="font-medium md:text-right">{euro(gesamt)}</span>
                  </>
                ) : gruppe != null ? (
                  <span className="col-start-2 font-semibold md:col-span-5 md:col-start-auto md:text-right">{euro(gruppe)}</span>
                ) : <span className="hidden md:col-span-5 md:block" />}
              </summary>

              <div className="space-y-3 bg-slate-50 px-4 py-3">
                <AktionsFormular key={`${p.menge}-${p.einzelpreis}-${p.aufmass.length}`} aktion={positionAktion} knopf="Position speichern" className="grid gap-3 md:grid-cols-6">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="positionId" value={p.id} />
                  <input type="hidden" name="art" value={p.art} />
                  <fieldset disabled={!offen} className="contents">
                    <div><label className="label">OZ</label><input name="oz" defaultValue={p.oz ?? ""} placeholder={p.posNr} className="eingabe" /></div>
                    <div className="md:col-span-5"><label className="label">Kurztext</label><input name="kurztext" defaultValue={p.kurztext} className="eingabe" /></div>
                    <div className="md:col-span-6"><label className="label">Langtext</label><textarea name="langtext" rows={2} defaultValue={p.langtext ?? ""} className="eingabe" /></div>
                    {p.art === "POSITION" && (
                      <>
                        <div>
                          <label className="label">Menge{p.aufmass.length ? " (Aufmaß)" : ""}</label>
                          <input name="menge" defaultValue={zahl(p.menge, 3)} readOnly={p.aufmass.length > 0} className={`eingabe ${p.aufmass.length ? "bg-slate-100" : ""}`} />
                        </div>
                        <div><label className="label">Einheit</label><input name="einheit" defaultValue={p.einheit} className="eingabe" /></div>
                        <div><label className="label">Einzelpreis €</label><input name="einzelpreis" defaultValue={zahl(p.einzelpreis)} className="eingabe" /></div>
                        <div>
                          <label className="label">Kostenart</label>
                          <select name="kostenart" defaultValue={p.kostenart} className="eingabe">{KOSTENARTEN.map((k) => <option key={k.wert} value={k.wert}>{k.text}</option>)}</select>
                        </div>
                        <div><label className="label">davon Arbeit €/Einh.</label><input name="lohnEp" defaultValue={zahl(p.lohnEp)} className="eingabe" title="Nur bei Kostenart gemischt" /></div>
                      </>
                    )}
                  </fieldset>
                </AktionsFormular>
                {offen && (
                  <AktionsFormular aktion={positionAktion} knopf="Position löschen" knopfKlasse="btn-hell text-red-600">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="positionId" value={p.id} />
                    <input type="hidden" name="loeschen" value="1" />
                  </AktionsFormular>
                )}

                {p.art === "POSITION" && (p.aufmass.length > 0 || offen) && (
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Mengennachweis (REB)</div>
                    <table className="w-full text-sm">
                      <thead className="text-xs text-slate-500">
                        <tr><th className="text-left font-normal">Datum</th><th className="text-left font-normal">Bezeichnung</th><th className="text-left font-normal">Ansatz</th><th className="text-right font-normal">Ergebnis</th><th /></tr>
                      </thead>
                      <tbody>
                        {p.aufmass.map((z) => {
                          let wert = "?";
                          try { wert = zahl(aufmassZeileWert(z), 3); } catch { /* ungültige Formel aus Altbestand */ }
                          return (
                            <tr key={z.id} className={z.abzug ? "text-red-700" : ""}>
                              <td className="whitespace-nowrap">{z.datum ? datum(z.datum) : ""}</td>
                              <td>{z.abzug ? "abzgl. " : ""}{z.text}{z.reb && <span className="block text-xs text-slate-500">REB: {z.reb}</span>}</td>
                              <td className="font-mono text-xs">{z.formel ?? [z.anzahl, z.laenge, z.breite, z.hoehe].filter((v) => v != null).map((v) => zahl(v, 3)).join(" × ")}</td>
                              <td className="text-right font-medium">{wert}</td>
                              <td className="text-right">
                                {offen && <form action={aufmassLoeschenAktion}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="zeileId" value={z.id} /><button className="text-xs text-red-600" aria-label="Zeile löschen">✕</button></form>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {offen && (
                      <AktionsFormular aktion={aufmassAktion} knopf="+ Zeile" knopfKlasse="btn-hell" zuruecksetzen className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[8.5rem_1fr_1fr_4.5rem_4.5rem_4.5rem_4.5rem_auto]">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="positionId" value={p.id} />
                        <input type="date" name="datum" defaultValue={isoTag(new Date())} className="eingabe" aria-label="Datum" />
                        <input name="text" placeholder="z. B. Achse 3–5" className="eingabe" aria-label="Bezeichnung" />
                        <input name="formel" placeholder="Formel, z. B. 12,5*3,2-0,8^2" className="eingabe font-mono" aria-label="Formel" />
                        <input name="anzahl" placeholder="Anz." className="eingabe" aria-label="Anzahl" />
                        <input name="laenge" placeholder="L" className="eingabe" aria-label="Länge" />
                        <input name="breite" placeholder="B" className="eingabe" aria-label="Breite" />
                        <input name="hoehe" placeholder="H" className="eingabe" aria-label="Höhe" />
                        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="abzug" /> Abzug</label>
                      </AktionsFormular>
                    )}
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {positionen.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Noch keine Positionen.</p>}

        {offen && (
          <div className="space-y-3 border-t border-slate-200 px-4 py-3">
            <AktionsFormular aktion={positionNeuAktion} knopf="+ Position" zuruecksetzen className="grid gap-2 sm:grid-cols-[7rem_1fr_6rem_5rem_7rem_8rem]">
              <input type="hidden" name="id" value={r.id} />
              <select name="art" className="eingabe" aria-label="Art"><option value="POSITION">Position</option><option value="GRUPPE">Titel</option><option value="TEXT">Hinweis</option></select>
              <input name="kurztext" placeholder="Kurztext" required className="eingabe" aria-label="Kurztext" />
              <input name="menge" placeholder="Menge" className="eingabe" aria-label="Menge" />
              <input name="einheit" placeholder="Einh." className="eingabe" aria-label="Einheit" />
              <input name="einzelpreis" placeholder="EP €" className="eingabe" aria-label="Einzelpreis" />
              <select name="kostenart" defaultValue="LOHN" className="eingabe" aria-label="Kostenart">{KOSTENARTEN.map((k) => <option key={k.wert} value={k.wert}>{k.text}</option>)}</select>
            </AktionsFormular>
            <details className="text-sm">
              <summary className="cursor-pointer text-marke">Mengen aus GAEB X31 übernehmen</summary>
              <AktionsFormular aktion={x31Aktion} knopf="Mengen importieren" knopfKlasse="btn-hell" encType="multipart/form-data" className="mt-2 grid gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input type="file" name="datei" required accept=".x31,.d31,.xml" className="text-sm" />
                <p className="text-xs text-slate-500">Zuordnung über die Ordnungszahl; jede Menge wird als Aufmaßzeile mit den REB-Zeilen gespeichert.</p>
              </AktionsFormular>
            </details>
          </div>
        )}

        <div className="flex justify-end border-t border-slate-200 px-4 py-3 text-sm">
          <dl className="grid grid-cols-[auto_8rem] gap-x-6 gap-y-1">
            <dt>{r.verrechnungen.length ? "Gesamtleistung netto" : "Summe netto"}</dt><dd className="text-right">{euro(be.leistung.netto)}</dd>
            <dt>{r.steuerschuldUmkehr ? "USt. (§ 13b UStG)" : `zzgl. ${zahl(be.mwstSatz)} % USt.`}</dt><dd className="text-right">{euro(be.leistung.mwst)}</dd>
            <dt>{r.verrechnungen.length ? "Gesamtleistung brutto" : "Rechnungsbetrag brutto"}</dt><dd className="text-right">{euro(be.leistung.brutto)}</dd>
            {r.verrechnungen.length > 0 && (
              <>
                <dt>abzgl. verrechnete Rechnungen</dt><dd className="text-right">{euro(-be.abzug.brutto)}</dd>
                <dt className="text-slate-500">Rest netto / USt.</dt><dd className="text-right text-slate-500">{euro(be.netto)} / {euro(be.mwst)}</dd>
                <dt>Rechnungsbetrag brutto</dt><dd className="text-right">{euro(be.brutto)}</dd>
              </>
            )}
            {be.einbehaltFreigabe !== 0 && <><dt>zzgl. Einbehalte aus Abschlägen</dt><dd className="text-right">{euro(be.einbehaltFreigabe)}</dd></>}
            {be.einbehalt !== 0 && <><dt>abzgl. Sicherheitseinbehalt {zahl(r.einbehaltProzent)} %</dt><dd className="text-right">{euro(-be.einbehalt)}</dd></>}
            <dt className="font-semibold">{be.zahlbetrag < 0 ? "Erstattung" : "Zahlbetrag"}</dt><dd className="text-right font-semibold">{euro(be.zahlbetrag)}</dd>
            {be.skonto > 0 && <><dt className="text-slate-500">Skonto {zahl(r.skontoProzent)} % bis {datum(faelligAm(r.datum, r.skontoTage))}</dt><dd className="text-right text-slate-500">{euro(be.skonto)}</dd></>}
          </dl>
        </div>
      </section>
    </div>
  );
}

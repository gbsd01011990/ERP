import Link from "next/link";
import { benutzerPflicht } from "@/lib/auth";
import { datum, datumZeit } from "@/lib/format";
import { db } from "@/lib/db";
import { berlinTag } from "@/lib/zeit";
import { ANSICHTEN, ZIELGRUPPEN, trefferListe, zaehler, type Ansicht } from "@/lib/dienste/foerdermittel";
import { AktionsFormular } from "@/components/aktions-formular";
import { aufgabeAktion, notizAktion, projektAktion, statusAktion } from "./actions";

const TITEL: Record<Ansicht, string> = { NEU: "Neu", GEMERKT: "Gemerkt", BEANTRAGT: "Beantragt / genutzt", AUSSORTIERT: "Aussortiert", BEENDET: "Beendet" };
const ZG: Record<(typeof ZIELGRUPPEN)[number], string> = { alle: "Alle", betrieb: "Für den Betrieb", kunde: "Für Kunden" };

function Marke({ children, art }: { children: React.ReactNode; art: "betrieb" | "kunde" | "grau" | "frist" | "punkte" }) {
  const farbe = { betrieb: "bg-sky-100 text-sky-800", kunde: "bg-emerald-100 text-emerald-800", grau: "bg-slate-100 text-slate-600", frist: "bg-amber-100 text-amber-800", punkte: "bg-marke-hell text-marke-dunkel" }[art];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${farbe}`}>{children}</span>;
}

export default async function Foerdermittel({ searchParams }: { searchParams: Promise<{ ansicht?: string; zg?: string }> }) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const sp = await searchParams;
  const ansicht = (ANSICHTEN as readonly string[]).includes(sp.ansicht ?? "") ? (sp.ansicht as Ansicht) : "NEU";
  const zg = (ZIELGRUPPEN as readonly string[]).includes(sp.zg ?? "") ? (sp.zg as (typeof ZIELGRUPPEN)[number]) : "alle";
  const [liste, z, letzter, projekte] = await Promise.all([
    trefferListe(b, ansicht, zg),
    zaehler(b.mandant.id),
    db.foerderLauf.findFirst({ where: { ende: { not: null } }, orderBy: { start: "desc" } }),
    db.projekt.findMany({ where: { firmaId: b.mandant.id, status: { abgeschlossen: false } }, select: { id: true, nummer: true, titel: true }, orderBy: { nummer: "desc" }, take: 200 }),
  ]);
  const heute = berlinTag(new Date());
  const link = (a: Ansicht, g = zg) => `/foerdermittel?${new URLSearchParams({ ...(a !== "NEU" ? { ansicht: a } : {}), ...(g !== "alle" ? { zg: g } : {}) })}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Fördermittel</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Förderprogramme von Bund, Berlin und Brandenburg aus der Förderdatenbank des Bundes, geprüft für {b.mandant.name}:
            Geld für den eigenen Betrieb und Programme, mit denen Kunden Begrünung, Entsiegelung oder Bäume bezahlt bekommen.
            {letzter && <> Letzter Abruf: {datumZeit(letzter.start)}{letzter.fehler ? <span className="text-red-600"> (Fehler: {letzter.fehler})</span> : `, ${letzter.neu} neu`}.</>}
          </p>
        </div>
        {b.rolle === "ADMIN" && <Link href="/einstellungen/foerdermittel" className="btn-hell">Profil und Abruf</Link>}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {ANSICHTEN.map((a) => {
          const n = a === "BEENDET" ? null : z[a];
          return <Link key={a} href={link(a)} className={ansicht === a ? "btn" : "btn-hell"}>{TITEL[a]}{n ? ` (${n})` : ""}</Link>;
        })}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {ZIELGRUPPEN.map((g) => <Link key={g} href={link(ansicht, g)} className={`rounded-full border px-3 py-1 ${zg === g ? "border-marke bg-marke-hell text-marke-dunkel" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>{ZG[g]}</Link>)}
      </div>

      {liste.length === 0 ? (
        <p className="karte text-sm text-slate-500">
          {ansicht === "NEU" ? "Keine neuen Förderprogramme. Das Radar prüft die Förderdatenbank jeden Morgen." : "Hier liegt nichts."}
        </p>
      ) : (
        <ul className="space-y-3">
          {liste.map((t) => {
            const p = t.programm;
            const frist = p.fristen.find((f) => f >= heute);
            const kontakt = p.kontakt as Record<string, string> | null;
            return (
              <li key={t.id} className="karte space-y-2" id={t.id}>
                <div className="flex flex-wrap items-center gap-2">
                  {t.zielgruppen.includes("betrieb") && <Marke art="betrieb">Für den Betrieb</Marke>}
                  {t.zielgruppen.includes("kunde") && <Marke art="kunde">Für Kunden</Marke>}
                  {p.foerderart.map((a) => <Marke key={a} art="grau">{a}</Marke>)}
                  {frist && <Marke art="frist">Frist laut Text {frist.split("-").reverse().join(".")}</Marke>}
                  <span title={t.gruende.join("\n")}><Marke art="punkte">{t.punkte} Punkte</Marke></span>
                  <span className="text-xs text-slate-500">{p.gebiete.join(", ")}</span>
                  {p.beendetAm && <Marke art="grau">beendet seit {datum(p.beendetAm)}</Marke>}
                  {t.projekt && <Link href={`/projekte/${t.projekt.id}`} className="ml-auto text-sm text-marke hover:underline">Projekt {t.projekt.nummer}</Link>}
                </div>
                <h2 className="font-semibold leading-snug">{p.titel}</h2>
                <div className="text-sm text-slate-600">
                  {[p.foerdergeber, p.berechtigte.length ? `für ${p.berechtigte.join(", ")}` : null, p.bereiche.join(", ")].filter(Boolean).join(" · ")}
                </div>
                {p.kurztext && <p className="whitespace-pre-line text-sm text-slate-700">{p.kurztext}</p>}
                {(p.volltext || p.zusatzinfos || kontakt) && (
                  <details className="text-sm text-slate-700">
                    <summary className="cursor-pointer text-slate-500">Details, Voraussetzungen, Ansprechpartner</summary>
                    {p.volltext && <p className="mt-2 whitespace-pre-line">{p.volltext}</p>}
                    {p.zusatzinfos && <p className="mt-2 whitespace-pre-line text-slate-600">{p.zusatzinfos}</p>}
                    {kontakt?.name && (
                      <p className="mt-2 text-slate-600">
                        Ansprechpunkt: {[kontakt.name, kontakt.strasse, kontakt.ort, kontakt.telefon && `Tel. ${kontakt.telefon}`].filter(Boolean).join(", ")}
                        {kontakt.email && <> · <a className="text-marke" href={`mailto:${kontakt.email}`}>{kontakt.email}</a></>}
                      </p>
                    )}
                  </details>
                )}
                <div className="text-xs text-slate-500">Treffer: {t.gruende.join(" · ")}</div>
                {t.notiz && <div className="rounded bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">Notiz{t.bearbeitetVon ? ` (${t.bearbeitetVon.name})` : ""}:</span> {t.notiz}</div>}
                <div className="flex flex-wrap items-start gap-2 pt-1 text-sm">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn-hell">Förderdatenbank ↗</a>
                  {p.links.slice(0, 2).map((l, i) => <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="btn-hell">{i === 0 ? "Förderstelle ↗" : "Weiterer Link ↗"}</a>)}
                  {ansicht !== "BEENDET" && (
                    <>
                      {t.status !== "GEMERKT" && (
                        <AktionsFormular aktion={statusAktion} knopf="Merken" knopfKlasse={t.status === "NEU" ? "btn" : "btn-hell"}>
                          <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="GEMERKT" />
                        </AktionsFormular>
                      )}
                      {t.status === "GEMERKT" && (
                        <AktionsFormular aktion={statusAktion} knopf={t.zielgruppen.includes("betrieb") ? "Beantragt" : "Kunde nutzt sie"} knopfKlasse="btn">
                          <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="BEANTRAGT" />
                        </AktionsFormular>
                      )}
                      <AktionsFormular aktion={aufgabeAktion} knopf="Aufgabe anlegen" knopfKlasse="btn-hell"><input type="hidden" name="id" value={t.id} /></AktionsFormular>
                      {t.status !== "AUSSORTIERT" && (
                        <AktionsFormular aktion={statusAktion} knopf="Aussortieren" knopfKlasse="btn-hell">
                          <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="AUSSORTIERT" />
                        </AktionsFormular>
                      )}
                      {t.status !== "NEU" && (
                        <AktionsFormular aktion={statusAktion} knopf="Zurück zu „Neu“" knopfKlasse="btn-hell">
                          <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="NEU" />
                        </AktionsFormular>
                      )}
                    </>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <details className="text-sm">
                    <summary className="cursor-pointer text-slate-500">{t.notiz ? "Notiz ändern" : "Notiz hinzufügen"}</summary>
                    <AktionsFormular aktion={notizAktion} knopf="Notiz speichern" knopfKlasse="btn-hell" className="mt-2 space-y-2">
                      <input type="hidden" name="id" value={t.id} />
                      <textarea name="notiz" defaultValue={t.notiz ?? ""} rows={2} className="eingabe w-full" placeholder="z. B. Steuerberater fragen, Kunde Müller informieren" />
                    </AktionsFormular>
                  </details>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-slate-500">{t.projekt ? "Projekt ändern" : "Einem Projekt zuordnen"}</summary>
                    <AktionsFormular aktion={projektAktion} knopf="Zuordnen" knopfKlasse="btn-hell" className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <select name="projektId" defaultValue={t.projektId ?? ""} className="eingabe min-w-0 flex-1">
                        <option value="">– kein Projekt –</option>
                        {projekte.map((x) => <option key={x.id} value={x.id}>{x.nummer} {x.titel}</option>)}
                      </select>
                    </AktionsFormular>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-slate-400">
        Quelle: Förderdatenbank des Bundes (foerderdatenbank.de), Bundesministerium für Wirtschaft und Energie. Fristen erkennt das Radar nur aus dem Text; maßgeblich ist die Richtlinie.
      </p>
    </div>
  );
}

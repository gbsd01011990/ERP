import Link from "next/link";
import { benutzerPflicht } from "@/lib/auth";
import { euro, datum, datumZeit } from "@/lib/format";
import { ANSICHTEN, trefferListe, zaehler } from "@/lib/dienste/radar";
import { db } from "@/lib/db";
import { AktionsFormular } from "@/components/aktions-formular";
import { notizAktion, projektAktion, statusAktion } from "./actions";

const TITEL: Record<(typeof ANSICHTEN)[number], string> = { NEU: "Neu", TEILNAHME: "Zur Teilnahme", AUSSORTIERT: "Aussortiert", ABGELAUFEN: "Abgelaufen" };
const ART: Record<string, string> = { works: "Bauleistung", services: "Dienstleistung", supplies: "Lieferung" };

/** Farbe nach Restzeit: bis 7 Tage rot, bis 21 Tage orange, danach grün, ohne Frist grau. */
function FristMarke({ frist, ohneZeit }: { frist: Date | null; ohneZeit: boolean }) {
  if (!frist) return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">ohne Frist</span>;
  const tage = Math.ceil((frist.getTime() - Date.now()) / 864e5);
  const farbe = tage < 0 ? "bg-slate-200 text-slate-600" : tage <= 7 ? "bg-red-100 text-red-800" : tage <= 21 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
  const rest = tage < 0 ? "abgelaufen" : tage === 0 ? "heute" : tage === 1 ? "morgen" : `noch ${tage} Tage`;
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${farbe}`} title="Angebotsfrist">Frist {ohneZeit ? datum(frist) : datumZeit(frist)} · {rest}</span>;
}

export default async function Ausschreibungen({ searchParams }: { searchParams: Promise<{ ansicht?: string }> }) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const sp = await searchParams;
  const ansicht = (ANSICHTEN as readonly string[]).includes(sp.ansicht ?? "") ? (sp.ansicht as (typeof ANSICHTEN)[number]) : "NEU";
  const [liste, z, letzter] = await Promise.all([
    trefferListe(b, ansicht),
    zaehler(b.mandant.id),
    db.radarLauf.findFirst({ where: { ende: { not: null } }, orderBy: { start: "desc" } }),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Ausschreibungen</h1>
          <p className="text-sm text-slate-500">
            Öffentliche Ausschreibungen aus dem Bund (oeffentlichevergabe.de) und Berlin, täglich abgeglichen mit dem Profil von {b.mandant.name}.
            {letzter && <> Letzter Abruf: {datumZeit(letzter.start)}{letzter.fehler ? <span className="text-red-600"> (Fehler: {letzter.fehler})</span> : `, ${letzter.neu} neu`}.</>}
          </p>
        </div>
        {b.rolle === "ADMIN" && <Link href="/einstellungen/radar" className="btn-hell">Profil und Abruf</Link>}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {ANSICHTEN.map((a) => {
          const n = a === "ABGELAUFEN" ? null : z[a];
          return (
            <Link key={a} href={a === "NEU" ? "/ausschreibungen" : `/ausschreibungen?ansicht=${a}`} className={ansicht === a ? "btn" : "btn-hell"}>
              {TITEL[a]}{n ? ` (${n})` : ""}
            </Link>
          );
        })}
      </div>

      {liste.length === 0 ? (
        <p className="karte text-sm text-slate-500">
          {ansicht === "NEU" ? "Keine neuen Ausschreibungen. Das Radar ruft jeden Morgen die Bekanntmachungen des Vortags ab." : "Hier liegt nichts."}
        </p>
      ) : (
        <ul className="space-y-3">
          {liste.map((t) => {
            const a = t.ausschreibung;
            return (
              <li key={t.id} className="karte space-y-2" id={t.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <FristMarke frist={a.frist} ohneZeit={a.fristOhneZeit} />
                  <span className="rounded bg-marke-hell px-2 py-0.5 text-xs text-marke-dunkel" title={t.gruende.join(", ")}>{t.punkte} Punkte</span>
                  <span className="text-xs text-slate-500">{a.quelle}{a.auftragsart ? ` · ${ART[a.auftragsart] ?? a.auftragsart}` : ""}{a.verfahren ? ` · ${a.verfahren}` : ""}</span>
                  {t.projekt && <Link href={`/projekte/${t.projekt.id}`} className="ml-auto text-sm text-marke hover:underline">Projekt {t.projekt.nummer}</Link>}
                </div>
                <h2 className="font-semibold leading-snug">{a.titel}</h2>
                <div className="text-sm text-slate-600">
                  {[a.auftraggeber, [a.plz, a.ort].filter(Boolean).join(" "), a.wert ? `geschätzt ${euro(a.wert)}` : null, a.veroeffentlicht ? `veröffentlicht ${datum(a.veroeffentlicht)}` : null].filter(Boolean).join(" · ")}
                </div>
                {a.beschreibung && (
                  <details className="text-sm text-slate-700">
                    <summary className="cursor-pointer text-slate-500">Beschreibung</summary>
                    <p className="mt-1 whitespace-pre-line">{a.beschreibung}</p>
                  </details>
                )}
                {t.gruende.length > 0 && <div className="text-xs text-slate-500">Treffer: {t.gruende.join(" · ")}</div>}
                {t.notiz && <div className="rounded bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">Notiz{t.bearbeitetVon ? ` (${t.bearbeitetVon.name})` : ""}:</span> {t.notiz}</div>}
                <div className="flex flex-wrap items-start gap-2 pt-1 text-sm">
                  {a.portalUrl && <a href={a.portalUrl} target="_blank" rel="noopener noreferrer" className="btn-hell">Vergabeunterlagen ↗</a>}
                  {a.bekanntmachungUrl && <a href={a.bekanntmachungUrl} target="_blank" rel="noopener noreferrer" className="btn-hell">Bekanntmachung ↗</a>}
                  {!t.projektId && (ansicht === "NEU" || ansicht === "AUSSORTIERT") && (
                    <AktionsFormular aktion={statusAktion} knopf="Teilnehmen" knopfKlasse="btn">
                      <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="TEILNAHME" />
                    </AktionsFormular>
                  )}
                  {!t.projektId && (ansicht === "TEILNAHME" || ansicht === "NEU") && (
                    <AktionsFormular aktion={projektAktion} knopf="Als Projekt anlegen" knopfKlasse={ansicht === "TEILNAHME" ? "btn" : "btn-hell"}>
                      <input type="hidden" name="id" value={t.id} />
                    </AktionsFormular>
                  )}
                  {!t.projektId && (ansicht === "NEU" || ansicht === "TEILNAHME") && (
                    <AktionsFormular aktion={statusAktion} knopf="Aussortieren" knopfKlasse="btn-hell">
                      <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="AUSSORTIERT" />
                    </AktionsFormular>
                  )}
                  {!t.projektId && ansicht !== "NEU" && ansicht !== "ABGELAUFEN" && (
                    <AktionsFormular aktion={statusAktion} knopf="Zurück zu „Neu“" knopfKlasse="btn-hell">
                      <input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="NEU" />
                    </AktionsFormular>
                  )}
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-slate-500">{t.notiz ? "Notiz ändern" : "Notiz hinzufügen"}</summary>
                  <AktionsFormular aktion={notizAktion} knopf="Notiz speichern" knopfKlasse="btn-hell" className="mt-2 space-y-2">
                    <input type="hidden" name="id" value={t.id} />
                    <textarea name="notiz" defaultValue={t.notiz ?? ""} rows={2} className="eingabe w-full" placeholder="z. B. Begehung am 12.12., Nachunternehmer fragen" />
                  </AktionsFormular>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

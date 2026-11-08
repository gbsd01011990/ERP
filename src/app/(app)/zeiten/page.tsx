import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { berlinTag, berlinUhrzeit, berlinZuUtc, tagPlus, wochenbeginn, kalenderwoche, minutenZwischen, stundenText, arbeitszeitPruefen } from "@/lib/zeit";
import { wochentagDatum } from "@/lib/format";
import { KATEGORIE_TEXT } from "@/lib/zeit-texte";
import { laufenderEintrag } from "@/lib/dienste/zeiten";
import { Stempeluhr } from "./stempeluhr";
import { EintragFormular } from "./eintrag-formular";
import { loeschenAktion, freigabeAktion } from "./actions";

type Props = { searchParams: Promise<{ tag?: string; mitarbeiter?: string }> };

export default async function Zeiten({ searchParams }: Props) {
  const b = await benutzerPflicht();
  const sp = await searchParams;
  const buero = b.rolle !== "KOLONNE";
  const heute = berlinTag(new Date());
  const tag = /^\d{4}-\d{2}-\d{2}$/.test(sp.tag ?? "") ? sp.tag! : heute;
  const woche = wochenbeginn(tag);

  // Büro darf die Woche eines anderen Mitarbeiters dieses Mandanten ansehen und bearbeiten
  const mitarbeiterId = buero && sp.mitarbeiter ? sp.mitarbeiter : b.id;
  const mitarbeiter = await db.benutzer.findFirst({ where: { id: mitarbeiterId, zugriffe: { some: { firmaId: b.mandant.id } } } });
  if (!mitarbeiter) notFound();
  const fremd = mitarbeiter.id !== b.id;

  const [eintraege, laufend, projekte] = await Promise.all([
    db.zeiteintrag.findMany({
      where: { firmaId: b.mandant.id, benutzerId: mitarbeiter.id, beginn: { gte: berlinZuUtc(woche), lt: berlinZuUtc(tagPlus(woche, 7)) } },
      include: { projekt: true },
      orderBy: { beginn: "asc" },
    }),
    fremd ? null : laufenderEintrag(b.id),
    db.projekt.findMany({ where: { firmaId: b.mandant.id, status: { abgeschlossen: false } }, orderBy: { nummer: "desc" }, take: 300 }),
  ]);
  const projektOpts = projekte.map((p) => ({ id: p.id, text: `${p.nummer} ${p.titel}` }));
  const tage = Array.from({ length: 7 }, (_, i) => tagPlus(woche, i));
  const proTag = tage.map((t) => {
    const liste = eintraege.filter((e) => berlinTag(e.beginn) === t);
    return { tag: t, liste, ...arbeitszeitPruefen(liste) };
  });
  const summeWoche = proTag.reduce((s, t) => s + t.arbeit, 0);
  const offen = eintraege.filter((e) => e.ende && !e.freigegebenAm).length;
  const link = (t: string) => `/zeiten?tag=${t}${fremd ? `&mitarbeiter=${mitarbeiter.id}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">{fremd ? `Zeiten: ${mitarbeiter.name}` : "Meine Zeiten"}</h1>
        {buero && <Link href="/zeiten/team" className="btn-hell ml-auto">Team-Übersicht</Link>}
      </div>

      {!fremd && (
        <Stempeluhr
          laufend={laufend ? { beginn: laufend.beginn.toISOString(), kategorie: laufend.kategorie, projekt: laufend.projekt ? `${laufend.projekt.nummer} ${laufend.projekt.titel}` : null } : null}
          seitText={laufend ? berlinUhrzeit(laufend.beginn) : ""}
          projekte={projektOpts}
        />
      )}

      {/* Woche */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={link(tagPlus(woche, -7))} className="btn-hell" aria-label="Vorige Woche">←</Link>
        <span className="font-semibold">KW {kalenderwoche(woche)} · {wochentagDatum(berlinZuUtc(woche))} – {wochentagDatum(berlinZuUtc(tagPlus(woche, 6)))}</span>
        <Link href={link(tagPlus(woche, 7))} className="btn-hell" aria-label="Nächste Woche">→</Link>
        {woche !== wochenbeginn(heute) && <Link href={link(heute)} className="text-sm text-marke">diese Woche</Link>}
        <span className="ml-auto text-sm">Arbeitszeit <b>{stundenText(summeWoche)} h</b></span>
        {buero && fremd && offen > 0 && (
          <form action={freigabeAktion}>
            <input type="hidden" name="woche" value={woche} /><input type="hidden" name="benutzerId" value={mitarbeiter.id} />
            <button className="btn">Woche freigeben ({offen})</button>
          </form>
        )}
      </div>

      <div className="space-y-3">
        {proTag.map((t) => (
          <section key={t.tag} className={`karte p-0 ${t.tag === heute ? "ring-1 ring-marke" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-3 px-4 py-2">
              <h2 className="font-semibold">{wochentagDatum(berlinZuUtc(t.tag))}</h2>
              <span className="text-sm text-slate-500">Arbeit {stundenText(t.arbeit)} h{t.pause ? ` · Pause ${t.pause} min` : ""}</span>
              {t.hinweise.map((h) => <span key={h} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{h}</span>)}
            </div>
            {t.liste.length > 0 && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {t.liste.map((e) => {
                  const gesperrt = !!e.freigegebenAm && b.rolle !== "ADMIN";
                  return (
                    <li key={e.id}>
                      <details>
                        <summary className="flex cursor-pointer list-none flex-wrap gap-x-3 px-4 py-2">
                          <span className="w-28 tabular-nums">{berlinUhrzeit(e.beginn)} – {e.ende ? berlinUhrzeit(e.ende) : "läuft"}</span>
                          <span className={`w-28 ${e.kategorie === "PAUSE" ? "text-slate-400" : ""}`}>{KATEGORIE_TEXT[e.kategorie]}</span>
                          <span className="flex-1">{e.projekt ? `${e.projekt.nummer} ${e.projekt.titel}` : ""}{e.notiz ? <span className="text-slate-500"> · {e.notiz}</span> : null}</span>
                          <span className="tabular-nums">{e.ende ? stundenText(minutenZwischen(e.beginn, e.ende)) : ""}</span>
                          {e.freigegebenAm && <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">freigegeben</span>}
                        </summary>
                        {e.ende && (
                          <div className="space-y-2 bg-slate-50 px-4 py-3">
                            {gesperrt && <p className="text-xs text-slate-500">Freigegeben, Änderungen nur durch einen Admin.</p>}
                            <EintragFormular
                              benutzerId={mitarbeiter.id}
                              projekte={projektOpts}
                              gesperrt={gesperrt}
                              werte={{ id: e.id, tag: berlinTag(e.beginn), von: berlinUhrzeit(e.beginn), bis: berlinUhrzeit(e.ende), kategorie: e.kategorie, projektId: e.projektId, notiz: e.notiz }}
                            />
                            {!gesperrt && (
                              <form action={loeschenAktion}><input type="hidden" name="id" value={e.id} /><button className="text-xs text-red-600">Eintrag löschen</button></form>
                            )}
                          </div>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      <details className="karte" open={eintraege.length === 0 && fremd}>
        <summary className="cursor-pointer font-semibold">+ Zeit nachtragen</summary>
        <div className="mt-4">
          <EintragFormular benutzerId={mitarbeiter.id} projekte={projektOpts} werte={{ tag: tag > heute ? heute : tag, von: "07:00", bis: "16:00", kategorie: "UMSETZUNG", projektId: null, notiz: null }} />
          <p className="mt-2 text-xs text-slate-500">Liegt „bis“ vor „von“, endet der Eintrag am Folgetag (Nachtarbeit).</p>
        </div>
      </details>
    </div>
  );
}

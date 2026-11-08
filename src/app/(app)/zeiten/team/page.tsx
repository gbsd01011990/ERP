import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { berlinTag, berlinZuUtc, tagPlus, wochenbeginn, kalenderwoche, stundenText, arbeitszeitPruefen } from "@/lib/zeit";
import { wochentagDatum } from "@/lib/format";
import { freigabeAktion } from "../actions";

type Props = { searchParams: Promise<{ tag?: string }> };

export default async function TeamZeiten({ searchParams }: Props) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const heute = berlinTag(new Date());
  const sp = await searchParams;
  const woche = wochenbeginn(/^\d{4}-\d{2}-\d{2}$/.test(sp.tag ?? "") ? sp.tag! : heute);
  const tage = Array.from({ length: 7 }, (_, i) => tagPlus(woche, i));

  const [mitarbeiter, eintraege] = await Promise.all([
    db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: b.mandant.id } } }, orderBy: [{ rolle: "desc" }, { name: "asc" }] }),
    db.zeiteintrag.findMany({
      where: { firmaId: b.mandant.id, beginn: { gte: berlinZuUtc(woche), lt: berlinZuUtc(tagPlus(woche, 7)) } },
      orderBy: { beginn: "asc" },
    }),
  ]);

  const zeilen = mitarbeiter.map((m) => {
    const eigene = eintraege.filter((e) => e.benutzerId === m.id);
    const proTag = tage.map((t) => arbeitszeitPruefen(eigene.filter((e) => berlinTag(e.beginn) === t)));
    return {
      m,
      proTag,
      summe: proTag.reduce((s, x) => s + x.arbeit, 0),
      offen: eigene.filter((e) => e.ende && !e.freigegebenAm).length,
      freigegeben: eigene.filter((e) => e.freigegebenAm).length,
      laeuft: eigene.some((e) => !e.ende),
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="h1 mr-4">Team-Zeiten</h1>
        <Link href={`/zeiten/team?tag=${tagPlus(woche, -7)}`} className="btn-hell" aria-label="Vorige Woche">←</Link>
        <span className="font-semibold">KW {kalenderwoche(woche)}</span>
        <Link href={`/zeiten/team?tag=${tagPlus(woche, 7)}`} className="btn-hell" aria-label="Nächste Woche">→</Link>
        <a href={`/zeiten/export?woche=${woche}`} className="btn-hell ml-auto">CSV für Lohnabrechnung</a>
      </div>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              {tage.map((t) => <th key={t} className="text-right">{wochentagDatum(berlinZuUtc(t))}</th>)}
              <th className="text-right">Woche</th><th>Freigabe</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map(({ m, proTag, summe, offen, freigegeben, laeuft }) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">
                  <Link href={`/zeiten?tag=${woche}&mitarbeiter=${m.id}`} className="font-medium text-marke">{m.name}</Link>
                  {laeuft && <span className="ml-2 rounded bg-sky-100 px-1.5 text-xs text-sky-800">eingestempelt</span>}
                </td>
                {proTag.map((x, i) => (
                  <td key={i} className={`text-right tabular-nums ${x.hinweise.length ? "bg-amber-50 text-amber-800" : ""}`} title={x.hinweise.join(" ")}>
                    {x.arbeit ? stundenText(x.arbeit) : <span className="text-slate-300">–</span>}
                  </td>
                ))}
                <td className="text-right font-semibold tabular-nums">{stundenText(summe)}</td>
                <td className="whitespace-nowrap">
                  {offen > 0 ? (
                    <form action={freigabeAktion}>
                      <input type="hidden" name="woche" value={woche} /><input type="hidden" name="benutzerId" value={m.id} />
                      <button className="btn-hell py-1">Freigeben ({offen})</button>
                    </form>
                  ) : freigegeben > 0 ? (
                    <span className="flex items-center gap-2">
                      <span className="text-emerald-700">freigegeben</span>
                      {b.rolle === "ADMIN" && (
                        <form action={freigabeAktion}>
                          <input type="hidden" name="woche" value={woche} /><input type="hidden" name="benutzerId" value={m.id} /><input type="hidden" name="aufheben" value="1" />
                          <button className="text-xs text-slate-500 hover:text-red-600">aufheben</button>
                        </form>
                      )}
                    </span>
                  ) : <span className="text-slate-400">–</span>}
                </td>
              </tr>
            ))}
            {zeilen.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-500">Keine Mitarbeiter in diesem Mandanten.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Gelb markierte Tage verletzen Pausen- oder Höchstarbeitszeitregeln des Arbeitszeitgesetzes (Hinweis beim Darüberfahren). Freigegebene Einträge sind für Mitarbeiter gesperrt.</p>
    </div>
  );
}

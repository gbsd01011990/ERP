import Link from "next/link";
import type { Aufgabe, Benutzer, Projekt, Kontakt } from "@prisma/client";
import { berlinTag } from "@/lib/zeit";
import { datum, kontaktName } from "@/lib/format";
import { erledigtAktion, verschiebenAktion } from "@/app/(app)/posteingang/actions";

export type AufgabeMitBezug = Aufgabe & { zustaendig: Pick<Benutzer, "name"> | null; projekt: Pick<Projekt, "id" | "nummer" | "titel"> | null; kontakt: Kontakt | null };

/** Aufgabenliste mit Fälligkeitsfarbe, Erledigen und Verschieben. */
export function AufgabenListe({ aufgaben, bezugZeigen = true, leer = "Keine offenen Aufgaben." }: { aufgaben: AufgabeMitBezug[]; bezugZeigen?: boolean; leer?: string }) {
  const heute = berlinTag(new Date());
  if (aufgaben.length === 0) return <p className="text-sm text-slate-500">{leer}</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {aufgaben.map((a) => {
        const tag = a.faelligAm ? berlinTag(a.faelligAm) : null;
        const farbe = a.erledigtAm ? "text-slate-400" : !tag ? "text-slate-500" : tag < heute ? "font-medium text-red-700" : tag === heute ? "font-medium text-amber-700" : "text-slate-500";
        return (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <form action={erledigtAktion}>
              <input type="hidden" name="id" value={a.id} />{a.erledigtAm && <input type="hidden" name="wieder" value="1" />}
              <button className={`flex h-5 w-5 items-center justify-center rounded border ${a.erledigtAm ? "border-marke bg-marke text-white" : "border-slate-400 hover:border-marke"}`} aria-label={a.erledigtAm ? "Wieder öffnen" : "Erledigt"} title={a.erledigtAm ? "Wieder öffnen" : "Erledigt"}>
                {a.erledigtAm ? "✓" : ""}
              </button>
            </form>
            <span className={`w-24 shrink-0 ${farbe}`}>{tag ? (tag === heute ? "heute" : datum(a.faelligAm!)) : "ohne Datum"}</span>
            <span className={`min-w-0 flex-1 ${a.erledigtAm ? "text-slate-400 line-through" : ""}`}>
              {a.titel}
              {a.notiz && <span className="block text-xs text-slate-500">{a.notiz}</span>}
              {bezugZeigen && (a.projekt || a.kontakt) && (
                <span className="block text-xs">
                  {a.projekt ? <Link href={`/projekte/${a.projekt.id}`} className="text-marke">{a.projekt.nummer} {a.projekt.titel}</Link> : <Link href={`/kontakte/${a.kontakt!.id}`} className="text-marke">{kontaktName(a.kontakt!)}</Link>}
                </span>
              )}
              {a.emailId && <Link href={`/posteingang/${a.emailId}`} className="block text-xs text-marke">zur E-Mail</Link>}
            </span>
            <span className="text-xs text-slate-500">{a.zustaendig?.name}</span>
            {!a.erledigtAm && (
              <span className="flex gap-1">
                {[[1, "+1 Tag"], [7, "+1 Woche"]].map(([t, l]) => (
                  <form key={t} action={verschiebenAktion}>
                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="tage" value={t} />
                    <button className="rounded border border-slate-200 px-1.5 text-xs text-slate-500 hover:border-marke hover:text-marke">{l}</button>
                  </form>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const aufgabeInclude = { zustaendig: { select: { name: true } }, projekt: { select: { id: true, nummer: true, titel: true } }, kontakt: true } as const;

"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export type NavEintrag = { href: string; text: string; zaehler?: number; dringend?: boolean };
export type NavGruppe = { titel: string; eintraege: NavEintrag[]; klappbar?: boolean };
type Marke = { logo: string; breite: number; hoehe: number } | null;

/** Passt der Eintrag zur aktuellen Seite? Der genaueste Treffer gewinnt (längster Pfad, Abfrage zählt mit). */
function aktivFinden(gruppen: NavGruppe[], pfad: string, abfrage: string) {
  let best: { href: string; punkte: number } | null = null;
  for (const e of gruppen.flatMap((g) => g.eintraege)) {
    const [p, q] = e.href.split("?");
    const pfadPasst = p === "/" ? pfad === "/" : pfad === p || pfad.startsWith(p + "/");
    if (!pfadPasst) continue;
    const abfragePasst = q ? abfrage.includes(q) : true;
    if (!abfragePasst) continue;
    const punkte = p.length * 10 + (q ? 5 : 0) + (pfad === p ? 1 : 0);
    if (!best || punkte > best.punkte) best = { href: e.href, punkte };
  }
  return best?.href ?? null;
}

function Zaehler({ n, dringend }: { n?: number; dringend?: boolean }) {
  if (!n) return null;
  return <span className={`ml-auto rounded-full px-1.5 text-xs font-medium ${dringend ? "bg-red-600 text-white" : "bg-marke-hell text-marke-dunkel"}`}>{n > 99 ? "99+" : n}</span>;
}

function Liste({ gruppen, aktiv, onWahl }: { gruppen: NavGruppe[]; aktiv: string | null; onWahl?: () => void }) {
  return (
    <nav className="space-y-5 text-sm" aria-label="Hauptnavigation">
      {gruppen.map((g) => {
        const enthaeltAktiv = g.eintraege.some((e) => e.href === aktiv);
        const inhalt = (
          <ul className="mt-1 space-y-0.5">
            {g.eintraege.map((e) => (
              <li key={e.href}>
                <Link
                  href={e.href}
                  onClick={onWahl}
                  aria-current={e.href === aktiv ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${e.href === aktiv ? "bg-marke text-white" : "text-slate-700 hover:bg-slate-100"}`}
                >
                  <span className="truncate">{e.text}</span>
                  {e.href === aktiv ? (e.zaehler ? <span className="ml-auto text-xs">{e.zaehler}</span> : null) : <Zaehler n={e.zaehler} dringend={e.dringend} />}
                </Link>
              </li>
            ))}
          </ul>
        );
        return g.klappbar ? (
          <details key={g.titel} open={enthaeltAktiv} className="group">
            <summary className="cursor-pointer list-none px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600">
              {g.titel} <span className="inline-block transition-transform group-open:rotate-90">›</span>
            </summary>
            {inhalt}
          </details>
        ) : (
          <div key={g.titel}>
            {g.titel && <div className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.titel}</div>}
            {inhalt}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Seitenleiste (Rechner) bzw. Kopfzeile mit Menü und untere Schnellleiste (Handy).
 * Benutzerbereich (Passwort, Mandant, Abmelden) steht unten in der Leiste.
 */
export function AppNavigation({ gruppen, schnell, marke, firmaName, benutzer, fuss }: {
  gruppen: NavGruppe[]; schnell: NavEintrag[]; marke: Marke; firmaName: string; benutzer: string; fuss: React.ReactNode;
}) {
  const pfad = usePathname();
  const abfrage = useSearchParams().toString();
  const aktiv = aktivFinden(gruppen, pfad, abfrage);
  const [offen, setOffen] = useState(false);
  useEffect(() => setOffen(false), [pfad, abfrage]);
  useEffect(() => {
    document.body.style.overflow = offen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [offen]);

  const logo = (
    <Link href="/" className="flex items-center" title={firmaName}>
      {marke ? <Image src={marke.logo} alt={firmaName} width={marke.breite} height={marke.hoehe} className="h-12 w-auto max-w-[12rem] object-contain" priority /> : <span className="text-lg font-bold text-marke">{firmaName}</span>}
    </Link>
  );
  const aktivSchnell = aktivFinden([{ titel: "", eintraege: schnell }], pfad, abfrage);

  return (
    <>
      {/* Rechner: feste Seitenleiste */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="h-1 bg-marke" />
        <div className="px-5 py-4">{logo}</div>
        <div className="flex-1 overflow-y-auto px-2 pb-4"><Liste gruppen={gruppen} aktiv={aktiv} /></div>
        <div className="border-t border-slate-200 px-5 py-3 text-sm">
          <div className="truncate font-medium text-slate-700">{benutzer}</div>
          <div className="truncate text-xs text-slate-500">{firmaName}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">{fuss}</div>
        </div>
      </aside>

      {/* Handy und Tablet: Kopfzeile mit Menü */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:hidden">
        <div className="h-1 bg-marke" />
        <div className="flex items-center gap-3 px-4 py-2">
          {logo}
          <button type="button" onClick={() => setOffen(true)} className="btn-hell ml-auto" aria-expanded={offen} aria-controls="hauptmenue">☰ Menü</button>
        </div>
      </header>
      {offen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" id="hauptmenue">
          <button type="button" aria-label="Menü schließen" className="absolute inset-0 bg-slate-900/40" onClick={() => setOffen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex items-center px-4 py-3">{logo}<button type="button" onClick={() => setOffen(false)} className="ml-auto px-2 text-2xl text-slate-500" aria-label="Schließen">×</button></div>
            <div className="flex-1 overflow-y-auto px-2 pb-4"><Liste gruppen={gruppen} aktiv={aktiv} onWahl={() => setOffen(false)} /></div>
            <div className="border-t border-slate-200 px-4 py-3 text-sm"><div className="font-medium">{benutzer}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">{fuss}</div></div>
          </div>
        </div>
      )}

      {/* Handy: Schnellleiste unten */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${schnell.length + 1}, minmax(0, 1fr))` }} aria-label="Schnellzugriff">
        {schnell.map((e) => (
          <Link key={e.href} href={e.href} className={`relative flex flex-col items-center px-1 py-2 text-xs ${e.href === aktivSchnell ? "font-semibold text-marke" : "text-slate-600"}`}>
            <span className="truncate">{e.text}</span>
            {e.zaehler ? <span className={`absolute right-2 top-1 rounded-full px-1 text-[10px] ${e.dringend ? "bg-red-600 text-white" : "bg-marke text-white"}`}>{e.zaehler}</span> : null}
          </Link>
        ))}
        <button type="button" onClick={() => setOffen(true)} className="px-1 py-2 text-xs text-slate-600">Mehr …</button>
      </nav>
    </>
  );
}

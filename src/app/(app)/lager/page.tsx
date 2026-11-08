import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { eineFirma } from "@/lib/firmen-auswahl";
import { n } from "@/lib/kalkulation";
import { euro } from "@/lib/format";
import { FirmenTabs } from "@/components/firmen-tabs";
import { BuchungsFormular } from "./buchungs-formular";
import { artikelSpeichernAktion, lagerSpeichernAktion } from "./actions";
import { Journal } from "./journal";
import { AktionsFormular } from "@/components/aktions-formular";
import { preisangebotAktion } from "../angebote/gaeb-actions";

const LAGERART = { HAUPTLAGER: "Hauptlager", AUSSENLAGER: "Außenlager", FAHRZEUG: "Fahrzeug", BAUSTELLE: "Baustelle" } as const;
const zahl = (v: unknown) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n(v as number));

type Props = { searchParams: Promise<{ firma?: string; q?: string; ansicht?: string; knapp?: string }> };

export default async function LagerSeite({ searchParams }: Props) {
  const b = await benutzerPflicht();
  const sp = await searchParams;
  const { firma, firmen } = await eineFirma(b, sp.firma);
  const ansicht = sp.ansicht ?? "bestand";
  const buero = b.rolle !== "KOLONNE";

  const [lager, artikel, projekte] = await Promise.all([
    db.lager.findMany({ where: { firmaId: firma.id }, orderBy: [{ art: "asc" }, { name: "asc" }] }),
    db.artikel.findMany({
      where: {
        firmaId: firma.id, aktiv: true,
        ...(sp.q ? { OR: [{ bezeichnung: { contains: sp.q, mode: "insensitive" } }, { nummer: { contains: sp.q, mode: "insensitive" } }, { kategorie: { contains: sp.q, mode: "insensitive" } }] } : {}),
      },
      include: { bestaende: true },
      orderBy: [{ kategorie: "asc" }, { nummer: "asc" }],
    }),
    db.projekt.findMany({ where: { firmaId: firma.id, status: { abgeschlossen: false } }, orderBy: { nummer: "desc" }, include: { kontakt: true }, take: 300 }),
  ]);
  const aktiveLager = lager.filter((l) => l.aktiv);
  const zeilen = artikel
    .map((a) => {
      const gesamt = a.bestaende.reduce((s, x) => s + n(x.menge), 0);
      return { a, gesamt, wert: gesamt * n(a.durchschnittEk), knapp: a.mindestbestand != null && gesamt < n(a.mindestbestand) };
    })
    .filter((z) => !sp.knapp || z.knapp);
  const lagerwert = zeilen.reduce((s, z) => s + z.wert, 0);
  const knappAnzahl = zeilen.filter((z) => z.knapp).length;
  const q = (p: Record<string, string | undefined>) => `/lager?${new URLSearchParams(Object.entries({ firma: firma.id, ansicht, ...p }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Lager</h1>
        <span className="text-sm text-slate-500">Lagerwert {euro(lagerwert)}</span>
        {knappAnzahl > 0 && <Link href={q({ knapp: "1" })} className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{knappAnzahl} unter Mindestbestand</Link>}
      </div>
      <FirmenTabs firmen={firmen} aktiv={firma.id} pfad="/lager" />

      <details className="karte" open={aktiveLager.length > 0 && artikel.length > 0}>
        <summary className="cursor-pointer font-semibold">Buchen</summary>
        <div className="mt-4">
          {aktiveLager.length === 0 || artikel.length === 0 ? (
            <p className="text-sm text-slate-500">Lege zuerst ein Lager und einen Artikel an.</p>
          ) : (
            <BuchungsFormular
              nurEntnahme={!buero}
              artikel={artikel.map((a) => ({ id: a.id, text: `${a.nummer} ${a.bezeichnung} (${a.einheit})` }))}
              lager={aktiveLager.map((l) => ({ id: l.id, text: `${l.name} (${LAGERART[l.art]})` }))}
              projekte={projekte.map((p) => ({ id: p.id, text: `${p.nummer} ${p.titel}` }))}
            />
          )}
        </div>
      </details>

      <div className="flex flex-wrap gap-2 text-sm">
        {[["bestand", "Bestand"], ["buchungen", "Buchungen"], ["lager", `Lager (${lager.length})`]].map(([k, t]) => (
          <Link key={k} href={q({ ansicht: k })} className={ansicht === k ? "btn" : "btn-hell"}>{t}</Link>
        ))}
      </div>

      {ansicht === "bestand" && (
        <>
          <form className="flex flex-wrap gap-2">
            <input type="hidden" name="firma" value={firma.id} />
            <input name="q" defaultValue={sp.q} placeholder="Nummer, Bezeichnung, Kategorie" className="eingabe max-w-md" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="knapp" value="1" defaultChecked={!!sp.knapp} /> nur unter Mindestbestand</label>
            <button className="btn-hell">Filtern</button>
          </form>
          <div className="karte overflow-x-auto p-0">
            <table className="tabelle">
              <thead>
                <tr>
                  <th>Nr.</th><th>Artikel</th>
                  {aktiveLager.map((l) => <th key={l.id} className="text-right">{l.name}</th>)}
                  <th className="text-right">Gesamt</th><th className="text-right">Ø EK</th><th className="text-right">Wert</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map(({ a, gesamt, wert, knapp }) => (
                  <tr key={a.id} className={knapp ? "bg-red-50" : "hover:bg-slate-50"}>
                    <td className="whitespace-nowrap"><Link href={`/lager/artikel/${a.id}`} className="font-medium text-marke">{a.nummer}</Link></td>
                    <td>{a.bezeichnung}<span className="text-xs text-slate-500"> · {a.einheit}{a.kategorie ? ` · ${a.kategorie}` : ""}</span></td>
                    {aktiveLager.map((l) => {
                      const m = a.bestaende.find((x) => x.lagerId === l.id)?.menge;
                      return <td key={l.id} className="text-right">{m == null || n(m) === 0 ? <span className="text-slate-300">–</span> : zahl(m)}</td>;
                    })}
                    <td className={`text-right font-medium ${knapp ? "text-red-700" : ""}`} title={a.mindestbestand != null ? `Mindestbestand ${zahl(a.mindestbestand)}` : undefined}>{zahl(gesamt)}</td>
                    <td className="text-right">{euro(a.durchschnittEk)}</td>
                    <td className="text-right">{euro(wert)}</td>
                  </tr>
                ))}
                {zeilen.length === 0 && <tr><td colSpan={aktiveLager.length + 5} className="py-6 text-center text-slate-500">Keine Artikel.</td></tr>}
              </tbody>
            </table>
          </div>
          {buero && (
            <details className="karte">
              <summary className="cursor-pointer font-semibold">+ Neuer Artikel</summary>
              <form action={artikelSpeichernAktion} className="mt-4 grid gap-3 md:grid-cols-6">
                <input type="hidden" name="firmaId" value={firma.id} />
                <div><label className="label">Nummer</label><input name="nummer" required className="eingabe" /></div>
                <div className="md:col-span-2"><label className="label">Bezeichnung</label><input name="bezeichnung" required className="eingabe" /></div>
                <div><label className="label">Einheit</label><input name="einheit" defaultValue="Stk." className="eingabe" /></div>
                <div><label className="label">Kategorie</label><input name="kategorie" className="eingabe" /></div>
                <div><label className="label">Mindestbestand</label><input name="mindestbestand" inputMode="decimal" className="eingabe" /></div>
                <div className="md:col-span-2"><label className="label">Lieferant</label><input name="lieferant" className="eingabe" /></div>
                <div className="flex items-end"><button className="btn">Anlegen</button></div>
              </form>
            </details>
          )}
        </>
      )}

      {buero && (
        <details className="karte text-sm">
          <summary className="cursor-pointer font-semibold">Preisangebot vom Händler importieren (GAEB X94)</summary>
          <p className="mt-2 text-xs text-slate-500">Zuordnung über Artikelnummer (Lieferanten- oder eigene Nummer) oder EAN. Mit Häkchen wird der Preis je Einheit als letzter EK am Artikel gespeichert.</p>
          <AktionsFormular aktion={preisangebotAktion} knopf="Einlesen" knopfKlasse="btn-hell" encType="multipart/form-data" className="mt-2 grid gap-2 [&_[role=status]]:whitespace-pre-line">
            <input type="file" name="datei" required accept=".x93,.x94,.x96,.x97,.xml" className="text-sm" />
            <label className="flex items-center gap-2"><input type="checkbox" name="uebernehmen" /> Preise in die Artikel übernehmen</label>
          </AktionsFormular>
        </details>
      )}

      {ansicht === "buchungen" && <Journal firmaId={firma.id} />}

      {ansicht === "lager" && (
        <div className="space-y-3">
          <div className="karte p-0">
            {lager.map((l) => (
              <details key={l.id} className="border-b border-slate-100">
                <summary className={`flex cursor-pointer list-none gap-4 px-4 py-2 text-sm ${l.aktiv ? "" : "opacity-50"}`}>
                  <span className="flex-1 font-medium">{l.name}</span><span className="text-slate-500">{LAGERART[l.art]}</span><span className="text-slate-500">{l.adresse}</span>
                </summary>
                {buero && <div className="bg-slate-50 px-4 py-3"><LagerFormular firmaId={firma.id} l={l} /></div>}
              </details>
            ))}
            {lager.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Noch kein Lager.</p>}
          </div>
          {buero && (
            <details className="karte" open={lager.length === 0}>
              <summary className="cursor-pointer font-semibold">+ Neues Lager</summary>
              <div className="mt-4"><LagerFormular firmaId={firma.id} /></div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function LagerFormular({ firmaId, l }: { firmaId: string; l?: { id: string; name: string; art: keyof typeof LAGERART; adresse: string | null; aktiv: boolean } }) {
  return (
    <form action={lagerSpeichernAktion} className="grid gap-3 md:grid-cols-5">
      <input type="hidden" name="firmaId" value={firmaId} />
      {l && <input type="hidden" name="id" value={l.id} />}
      <div><label className="label">Name</label><input name="name" required defaultValue={l?.name} placeholder="z. B. Betriebshof" className="eingabe" /></div>
      <div>
        <label className="label">Art</label>
        <select name="art" defaultValue={l?.art ?? "HAUPTLAGER"} className="eingabe">
          {Object.entries(LAGERART).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="md:col-span-2"><label className="label">Adresse / Kennzeichen</label><input name="adresse" defaultValue={l?.adresse ?? ""} className="eingabe" /></div>
      {l && (
        <div><label className="label">Status</label><select name="aktiv" defaultValue={l.aktiv ? "an" : "aus"} className="eingabe"><option value="an">aktiv</option><option value="aus">inaktiv</option></select></div>
      )}
      <div className="flex items-end"><button className="btn">{l ? "Speichern" : "Anlegen"}</button></div>
    </form>
  );
}


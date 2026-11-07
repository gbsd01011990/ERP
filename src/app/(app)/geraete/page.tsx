import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { eineFirma } from "@/lib/firmen-auswahl";
import { datum, euro } from "@/lib/format";
import { maschinensatz, pruefAmpel } from "@/lib/rechnung/geraete";
import { AMPEL, KATEGORIE, STATUS } from "@/lib/geraete-texte";
import { FirmenTabs } from "@/components/firmen-tabs";
import { GeraetFormular } from "./geraet-formular";

type Props = { searchParams: Promise<{ firma?: string; q?: string; kategorie?: string; alle?: string; faellig?: string }> };

export default async function Geraete({ searchParams }: Props) {
  const b = await benutzerPflicht();
  const sp = await searchParams;
  const { firma, firmen } = await eineFirma(b, sp.firma);
  const [geraete, lager] = await Promise.all([
    db.geraet.findMany({
      where: {
        firmaId: firma.id,
        ...(sp.alle ? {} : { status: { not: "AUSGEMUSTERT" } }),
        ...(sp.kategorie && sp.kategorie in KATEGORIE ? { kategorie: sp.kategorie as keyof typeof KATEGORIE } : {}),
        ...(sp.q ? { OR: [{ bezeichnung: { contains: sp.q, mode: "insensitive" } }, { inventarNr: { contains: sp.q, mode: "insensitive" } }, { kennzeichen: { contains: sp.q, mode: "insensitive" } }, { hersteller: { contains: sp.q, mode: "insensitive" } }] } : {}),
      },
      include: { lager: true, pruefungen: { orderBy: { naechsteAm: "asc" } } },
      orderBy: [{ kategorie: "asc" }, { inventarNr: "asc" }],
    }),
    db.lager.findMany({ where: { firmaId: firma.id, aktiv: true }, orderBy: { name: "asc" } }),
  ]);
  const zeilen = geraete
    .map((g) => {
      const naechste = g.pruefungen.find((p) => p.naechsteAm) ?? null;
      return { g, naechste, ampel: pruefAmpel(naechste?.naechsteAm ?? null), satz: maschinensatz(g) };
    })
    .filter((z) => !sp.faellig || z.ampel === "ueberfaellig" || z.ampel === "bald");
  const faellig = zeilen.filter((z) => z.ampel === "ueberfaellig" || z.ampel === "bald").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Geräte und Maschinen</h1>
        <span className="text-sm text-slate-500">{zeilen.length} Geräte</span>
        {faellig > 0 && <Link href={`/geraete?firma=${firma.id}&faellig=1`} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{faellig} Prüfungen fällig</Link>}
      </div>
      <FirmenTabs firmen={firmen} aktiv={firma.id} pfad="/geraete" />
      <form className="flex flex-wrap gap-2">
        <input type="hidden" name="firma" value={firma.id} />
        <input name="q" defaultValue={sp.q} placeholder="Inventar-Nr., Bezeichnung, Kennzeichen" className="eingabe max-w-md" />
        <select name="kategorie" defaultValue={sp.kategorie ?? ""} className="eingabe w-auto">
          <option value="">Alle Kategorien</option>
          {Object.entries(KATEGORIE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="faellig" value="1" defaultChecked={!!sp.faellig} /> nur fällige Prüfungen</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="alle" value="1" defaultChecked={!!sp.alle} /> auch ausgemusterte</label>
        <button className="btn-hell">Filtern</button>
      </form>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Inv.-Nr.</th><th>Gerät</th><th>Kategorie</th><th>Status</th><th>Standort</th><th>Nächste Prüfung</th><th className="text-right">Satz €/h</th></tr></thead>
          <tbody>
            {zeilen.map(({ g, naechste, ampel, satz }) => (
              <tr key={g.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap"><Link href={`/geraete/${g.id}`} className="font-medium text-marke">{g.inventarNr}</Link></td>
                <td>{g.bezeichnung}<span className="text-xs text-slate-500">{g.kennzeichen ? ` · ${g.kennzeichen}` : ""}{g.hersteller ? ` · ${g.hersteller}` : ""}</span></td>
                <td>{KATEGORIE[g.kategorie]}</td>
                <td><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[g.status][1]}`}>{STATUS[g.status][0]}</span></td>
                <td>{g.lager?.name ?? "–"}</td>
                <td className="whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${AMPEL[ampel][1]}`}>{naechste?.naechsteAm ? datum(naechste.naechsteAm) : AMPEL[ampel][0]}</span>
                  {naechste && <span className="ml-1 text-xs text-slate-500">{naechste.art}</span>}
                </td>
                <td className="text-right">{satz.wirksam ? euro(satz.wirksam) : "–"}</td>
              </tr>
            ))}
            {zeilen.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Keine Geräte.</td></tr>}
          </tbody>
        </table>
      </div>
      {b.rolle !== "KOLONNE" && (
        <details className="karte">
          <summary className="cursor-pointer font-semibold">+ Neues Gerät</summary>
          <div className="mt-4"><GeraetFormular firmaId={firma.id} lager={lager} /></div>
        </details>
      )}
    </div>
  );
}

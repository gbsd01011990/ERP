import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { firmenFilter } from "@/lib/firma";
import { einzelpreisAnteile, n } from "@/lib/kalkulation";
import { euro } from "@/lib/format";
import { leistungSpeichern } from "./actions";
import type { Leistung, Firma } from "@prisma/client";

type Props = { searchParams: Promise<{ q?: string }> };

const zahl = (v: unknown) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n(v as number));

function Formular({ l, firmen, firmaId }: { l?: Leistung; firmen: Firma[]; firmaId: string }) {
  return (
    <form action={leistungSpeichern} className="grid gap-3 md:grid-cols-6">
      {l && <input type="hidden" name="id" value={l.id} />}
      <div>
        <label className="label">Firma</label>
        <select name="firmaId" defaultValue={l?.firmaId ?? firmaId} className="eingabe">
          {firmen.map((f) => <option key={f.id} value={f.id}>{f.kuerzel}</option>)}
        </select>
      </div>
      <div><label className="label">Nummer</label><input name="nummer" required defaultValue={l?.nummer} className="eingabe" /></div>
      <div className="md:col-span-3"><label className="label">Kurztext</label><input name="kurztext" required defaultValue={l?.kurztext} className="eingabe" /></div>
      <div><label className="label">Kategorie</label><input name="kategorie" defaultValue={l?.kategorie ?? ""} className="eingabe" /></div>
      <div className="md:col-span-6"><label className="label">Langtext</label><textarea name="langtext" rows={2} defaultValue={l?.langtext ?? ""} className="eingabe" /></div>
      <div><label className="label">Einheit</label><input name="einheit" defaultValue={l?.einheit ?? "Stk."} className="eingabe" /></div>
      <div><label className="label">Lohn min/Einh.</label><input name="minuten" defaultValue={l ? zahl(l.minuten) : ""} className="eingabe" /></div>
      <div><label className="label">Material EK €</label><input name="materialEk" defaultValue={l ? zahl(l.materialEk) : ""} className="eingabe" /></div>
      <div><label className="label">Gerät €</label><input name="geraete" defaultValue={l ? zahl(l.geraete) : ""} className="eingabe" /></div>
      <div><label className="label">Fremd EK €</label><input name="fremdEk" defaultValue={l ? zahl(l.fremdEk) : ""} className="eingabe" /></div>
      <div><label className="label">Festpreis € (optional)</label><input name="festpreis" defaultValue={l?.festpreis != null ? zahl(l.festpreis) : ""} className="eingabe" /></div>
      {l && (
        <div>
          <label className="label">Status</label>
          <select name="aktiv" defaultValue={l.aktiv ? "an" : "aus"} className="eingabe"><option value="an">aktiv</option><option value="aus">inaktiv</option></select>
        </div>
      )}
      <div className="flex items-end"><button className="btn">{l ? "Speichern" : "Anlegen"}</button></div>
    </form>
  );
}

export default async function Leistungen({ searchParams }: Props) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const { ids, aktiv } = await firmenFilter(b);
  const { q } = await searchParams;
  const firmen = b.zugriffe.map((z) => z.firma);
  const leistungen = await db.leistung.findMany({
    where: {
      firmaId: { in: ids },
      ...(q ? { OR: [{ kurztext: { contains: q, mode: "insensitive" } }, { nummer: { contains: q, mode: "insensitive" } }, { kategorie: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { firma: true },
    orderBy: [{ firmaId: "asc" }, { nummer: "asc" }],
  });

  return (
    <div className="space-y-4">
      <h1 className="h1">Leistungsstamm</h1>
      <details className="karte">
        <summary className="cursor-pointer font-semibold">+ Neue Leistung</summary>
        <div className="mt-4"><Formular firmen={firmen} firmaId={aktiv === "alle" ? firmen[0]?.id : aktiv} /></div>
      </details>
      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Nummer, Text, Kategorie" className="eingabe max-w-md" />
        <button className="btn-hell">Suchen</button>
      </form>
      <div className="karte p-0">
        {leistungen.map((l) => {
          const ep = l.festpreis != null ? n(l.festpreis) : einzelpreisAnteile(l, l.firma).summe;
          return (
            <details key={l.id} className="border-b border-slate-100">
              <summary className={`flex cursor-pointer list-none flex-wrap gap-x-4 px-4 py-2 text-sm ${l.aktiv ? "" : "opacity-50"}`}>
                <span className="w-12 text-xs text-slate-500">{l.firma.kuerzel}</span>
                <span className="w-24 font-medium">{l.nummer}</span>
                <span className="flex-1">{l.kurztext}</span>
                <span className="w-16 text-slate-500">{l.einheit}</span>
                <span className="w-28 text-right">{euro(ep)}{l.festpreis != null ? " (fest)" : ""}</span>
              </summary>
              <div className="bg-slate-50 px-4 py-3"><Formular l={l} firmen={firmen} firmaId={l.firmaId} /></div>
            </details>
          );
        })}
        {leistungen.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Noch keine Leistungen angelegt.</p>}
      </div>
      <p className="text-xs text-slate-500">
        Der Einzelpreis ergibt sich aus Lohnminuten × Stundensatz der Firma, Material-EK mit Aufschlag, Gerätekosten und Fremdleistung mit Aufschlag. Ein Festpreis ersetzt die Kalkulation.
      </p>
    </div>
  );
}

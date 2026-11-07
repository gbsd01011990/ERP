import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { n } from "@/lib/kalkulation";
import { euro } from "@/lib/format";
import { artikelSpeichernAktion } from "../../actions";
import { Journal } from "../../journal";

const zahl = (v: unknown) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n(v as number));

export default async function ArtikelSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht();
  const a = await db.artikel.findUnique({ where: { id: (await params).id }, include: { bestaende: { include: { lager: true } }, firma: true } });
  if (!a || !firmenIds(b).includes(a.firmaId)) notFound();
  const gesamt = a.bestaende.reduce((s, x) => s + n(x.menge), 0);
  const buero = b.rolle !== "KOLONNE";
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-slate-500"><Link href={`/lager?firma=${a.firmaId}`} className="text-marke">Lager {a.firma.name}</Link> · {a.nummer}</div>
        <h1 className="h1">{a.bezeichnung}</h1>
      </div>
      <section className="grid gap-3 sm:grid-cols-4">
        {[["Bestand", `${zahl(gesamt)} ${a.einheit}`], ["Ø EK", euro(a.durchschnittEk)], ["Letzter EK", euro(a.letzterEk)], ["Wert", euro(gesamt * n(a.durchschnittEk))]].map(([l, w]) => (
          <div key={l} className="karte py-3"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{w}</div></div>
        ))}
      </section>
      <section className="karte text-sm">
        <h2 className="mb-2 font-semibold">Bestand je Lager</h2>
        <ul className="divide-y divide-slate-100">
          {a.bestaende.filter((x) => n(x.menge) !== 0).map((x) => <li key={x.lagerId} className="flex py-1"><span className="flex-1">{x.lager.name}</span><span>{zahl(x.menge)} {a.einheit}</span></li>)}
          {gesamt === 0 && <li className="py-1 text-slate-500">Kein Bestand.</li>}
        </ul>
        {a.mindestbestand != null && <p className={`mt-2 ${gesamt < n(a.mindestbestand) ? "text-red-700" : "text-slate-500"}`}>Mindestbestand {zahl(a.mindestbestand)} {a.einheit}</p>}
      </section>
      {buero && (
        <details className="karte">
          <summary className="cursor-pointer font-semibold">Stammdaten bearbeiten</summary>
          <form action={artikelSpeichernAktion} className="mt-4 grid gap-3 md:grid-cols-6">
            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="firmaId" value={a.firmaId} />
            <div><label className="label">Nummer</label><input name="nummer" required defaultValue={a.nummer} className="eingabe" /></div>
            <div className="md:col-span-2"><label className="label">Bezeichnung</label><input name="bezeichnung" required defaultValue={a.bezeichnung} className="eingabe" /></div>
            <div><label className="label">Einheit</label><input name="einheit" defaultValue={a.einheit} className="eingabe" /></div>
            <div><label className="label">Kategorie</label><input name="kategorie" defaultValue={a.kategorie ?? ""} className="eingabe" /></div>
            <div><label className="label">Mindestbestand</label><input name="mindestbestand" defaultValue={a.mindestbestand != null ? zahl(a.mindestbestand) : ""} className="eingabe" /></div>
            <div className="md:col-span-2"><label className="label">Lieferant</label><input name="lieferant" defaultValue={a.lieferant ?? ""} className="eingabe" /></div>
            <div><label className="label">Status</label><select name="aktiv" defaultValue={a.aktiv ? "an" : "aus"} className="eingabe"><option value="an">aktiv</option><option value="aus">inaktiv</option></select></div>
            <div className="flex items-end"><button className="btn">Speichern</button></div>
          </form>
        </details>
      )}
      <h2 className="font-semibold">Buchungen</h2>
      <Journal firmaId={a.firmaId} artikelId={a.id} />
    </div>
  );
}

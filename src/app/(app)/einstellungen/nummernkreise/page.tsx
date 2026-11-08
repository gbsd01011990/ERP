import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { naechsteVorschau } from "@/lib/nummern";
import { ART_TEXT } from "@/lib/dienste/nummernkreise";
import { AktionsFormular } from "@/components/aktions-formular";
import { kreisAktion, zahlungAktion } from "./actions";

export default async function Nummernkreise() {
  const b = await benutzerPflicht(["ADMIN"]);
  const [kreise, firma] = await Promise.all([
    db.nummernkreis.findMany({ where: { firmaId: b.mandant.id }, orderBy: { art: "asc" } }),
    db.firma.findUniqueOrThrow({ where: { id: b.mandant.id } }),
  ]);
  const sortiert = [...kreise].sort((a, c) => (a.art === "RECHNUNG" ? -1 : c.art === "RECHNUNG" ? 1 : 0));
  return (
    <div className="space-y-4">
      <h1 className="h1">Nummernkreise · {firma.name}</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        Präfix, nächste Nummer und Stellenzahl sind frei einstellbar. Im Präfix setzt {"{JJJJ}"} das Jahr ein, {"{JJ}"} das Jahr zweistellig.
        Mit „jährlich neu“ beginnt der Kreis zum Jahreswechsel wieder bei 1. Rechnungsnummern vergibt das ERP erst beim Festschreiben, Entwürfe verbrauchen keine Nummer.
      </p>
      {sortiert.map((k) => (
        <section key={k.id} className="karte space-y-2">
          <h2 className="font-semibold">{ART_TEXT[k.art] ?? k.art}</h2>
          <AktionsFormular key={`${k.naechste}-${k.praefix}`} aktion={kreisAktion} knopf="Speichern" className="grid gap-3 sm:grid-cols-5">
            <input type="hidden" name="id" value={k.id} />
            <div><label className="label">Präfix</label><input name="praefix" defaultValue={k.praefix} className="eingabe" /></div>
            <div><label className="label">Nächste Nummer</label><input name="naechste" defaultValue={k.naechste} className="eingabe" /></div>
            <div><label className="label">Stellen</label><input name="stellen" defaultValue={k.stellen} className="eingabe" /></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="jahresweise" defaultChecked={k.jahresweise} /> jährlich neu</label>
            <div className="text-sm"><span className="label">Vorschau</span><span className="font-mono">{naechsteVorschau(k)}</span></div>
          </AktionsFormular>
        </section>
      ))}
      <section className="karte space-y-2">
        <h2 className="font-semibold">Zahlungsbedingungen für neue Rechnungen</h2>
        <AktionsFormular aktion={zahlungAktion} knopf="Speichern" className="grid gap-3 sm:grid-cols-4">
          <div><label className="label">Zahlungsziel Tage</label><input name="zahlungszielTage" defaultValue={firma.zahlungszielTage} className="eingabe" /></div>
          <div><label className="label">Skonto %</label><input name="skontoProzent" defaultValue={String(firma.skontoProzent).replace(".", ",")} className="eingabe" /></div>
          <div><label className="label">Skonto in Tagen</label><input name="skontoTage" defaultValue={firma.skontoTage} className="eingabe" /></div>
        </AktionsFormular>
      </section>
    </div>
  );
}

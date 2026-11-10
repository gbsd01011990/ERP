import { benutzerPflicht } from "@/lib/auth";
import { buchhaltungLaden } from "@/lib/dienste/zahlungen";
import { AktionsFormular } from "@/components/aktions-formular";
import { buchhaltungAktion } from "../../rechnungen/zahlung-actions";

const KONTEN = [
  ["kontoErloese19", "Erlöse 19 % USt"], ["kontoErloese7", "Erlöse 7 % USt"], ["kontoErloese13b", "Erlöse § 13b UStG"], ["kontoErloeseFrei", "Erlöse ohne USt (sonstige)"],
  ["kontoSkonto", "Gewährte Skonti 19 %"], ["kontoBank", "Bank"], ["kontoKasse", "Kasse"], ["kontoAusbuchung", "Forderungsverluste"],
] as const;

export default async function Buchhaltung() {
  const b = await benutzerPflicht(["ADMIN"]);
  const bh = await buchhaltungLaden(b.mandant.id);
  const z = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  return (
    <div className="space-y-4">
      <h1 className="h1">Buchhaltung · {b.mandant.name}</h1>
      <AktionsFormular aktion={buchhaltungAktion} knopf="Speichern" className="karte grid gap-4 md:grid-cols-4">
        <h2 className="font-semibold md:col-span-4">DATEV (Kanzlei)</h2>
        <div><label className="label">Beraternummer</label><input name="beraterNr" defaultValue={bh.beraterNr} className="eingabe" /></div>
        <div><label className="label">Mandantennummer</label><input name="mandantNr" defaultValue={bh.mandantNr} className="eingabe" /></div>
        <div><label className="label">Wirtschaftsjahr beginnt im Monat</label><input name="wjBeginnMonat" defaultValue={bh.wjBeginnMonat} className="eingabe" /></div>
        <div><label className="label">Erste Debitorennummer</label><input name="debitorStart" defaultValue={bh.debitorStart} className="eingabe" /></div>
        <h2 className="pt-2 font-semibold md:col-span-4">Konten (SKR03)</h2>
        {KONTEN.map(([k, l]) => <div key={k}><label className="label">{l}</label><input name={k} defaultValue={bh[k]} className="eingabe" /></div>)}
        <h2 className="pt-2 font-semibold md:col-span-4">Einkauf und Eingangsrechnungen</h2>
        <div><label className="label">Erste Kreditorennummer</label><input name="kreditorStart" defaultValue={bh.kreditorStart} className="eingabe" /></div>
        <div><label className="label">Wareneingang (Material)</label><input name="kontoWareneingang" defaultValue={bh.kontoWareneingang} className="eingabe" /></div>
        <div><label className="label">Fremdleistungen</label><input name="kontoFremdleistung" defaultValue={bh.kontoFremdleistung} className="eingabe" /></div>
        <div><label className="label">Geräte und Sonstiges</label><input name="kontoSonstiges" defaultValue={bh.kontoSonstiges} className="eingabe" /></div>
        <div><label className="label">Büro darf bestellen bis € netto</label><input name="bestellLimitBuero" defaultValue={z(bh.bestellLimitBuero)} className="eingabe" /></div>
        <div><label className="label">Büro darf Rechnungen freigeben bis € brutto</label><input name="freigabeLimitBuero" defaultValue={z(bh.freigabeLimitBuero)} className="eingabe" /></div>
        <div><label className="label">Preistoleranz gegenüber Bestellung %</label><input name="preisToleranz" defaultValue={z(bh.preisToleranz)} className="eingabe" /></div>
        <p className="text-xs text-slate-500 md:col-span-4">Darüber entscheidet ein Admin. Eingangsrechnungen bucht der DATEV-Export mit BU-Schlüssel 9 (19 % Vorsteuer), 8 (7 %) bzw. 94 (§ 13b) auf diese Konten gegen den Kreditor.</p>
        <h2 className="pt-2 font-semibold md:col-span-4">Mahnwesen</h2>
        <div><label className="label">Zahlungsfrist in Mahnungen (Tage)</label><input name="mahnFristTage" defaultValue={bh.mahnFristTage} className="eingabe" /></div>
        <div><label className="label">Gebühr 1. Mahnung €</label><input name="gebuehrStufe2" defaultValue={z(bh.gebuehrStufe2)} className="eingabe" /></div>
        <div><label className="label">Gebühr 2. Mahnung €</label><input name="gebuehrStufe3" defaultValue={z(bh.gebuehrStufe3)} className="eingabe" /></div>
        <div><label className="label">Basiszinssatz % (Bundesbank)</label><input name="basiszins" defaultValue={z(bh.basiszins)} placeholder="z. B. 1,27" className="eingabe" /></div>
        <p className="text-xs text-slate-500 md:col-span-4">
          Die Zahlungserinnerung ist kostenlos. Mahngebühren dürfen nur die tatsächlichen Kosten decken (Porto, Papier), keine Bearbeitungszeit.
          Den Basiszinssatz veröffentlicht die Bundesbank zum 1. Januar und 1. Juli; bitte dann hier anpassen. Die Konten bitte einmal mit der Kanzlei abstimmen.
        </p>
      </AktionsFormular>
    </div>
  );
}

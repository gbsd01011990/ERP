import { benutzerPflicht } from "@/lib/auth";
import { abgleichListe } from "@/lib/dienste/zahlungen";
import { datum, euro } from "@/lib/format";
import { AktionsFormular } from "@/components/aktions-formular";
import { RechnungenNav } from "@/components/rechnungen-nav";
import { auszugAktion, zuordnenAktion, uebergehenAktion } from "../zahlung-actions";

export default async function Kontoauszug() {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const { zeilen, kandidaten } = await abgleichListe(b);
  return (
    <div className="space-y-4">
      <h1 className="h1">Kontoauszug abgleichen</h1>
      <RechnungenNav aktiv="/rechnungen/bank" />
      <section className="karte space-y-2 text-sm">
        <h2 className="font-semibold">Kontoauszug einlesen</h2>
        <p className="text-slate-600">Im Online-Banking den Kontoauszug als <b>CAMT.053</b> (XML, bei manchen Banken „camt-Format“ oder „ISO 20022“) herunterladen. Doppelt eingelesene Umsätze erkennt das ERP. Ausgänge werden nur gespeichert, nicht abgeglichen.</p>
        <AktionsFormular aktion={auszugAktion} knopf="Einlesen" encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
          <input type="file" name="datei" accept=".xml,.camt,.053" required className="text-sm" />
        </AktionsFormular>
      </section>
      <section className="karte p-0 text-sm">
        <div className="border-b border-slate-200 px-4 py-2 font-semibold">Offene Zahlungseingänge ({zeilen.length})</div>
        {zeilen.map(({ u, vorschlag }) => (
          <div key={u.id} className="grid gap-2 border-b border-slate-100 px-4 py-3 lg:grid-cols-[7rem_7rem_1fr_28rem]">
            <span>{datum(u.buchungstag)}</span>
            <span className="font-medium">{euro(u.betrag)}</span>
            <span className="min-w-0"><b>{u.name ?? "–"}</b><span className="block truncate text-xs text-slate-500">{u.verwendungszweck}</span>
              {vorschlag && <span className={`block text-xs ${vorschlag.sicherheit === "sicher" ? "text-emerald-700" : "text-amber-700"}`}>{vorschlag.grund}</span>}
            </span>
            <div className="flex flex-wrap items-start gap-2">
              <AktionsFormular aktion={zuordnenAktion} knopf="Zuordnen" knopfKlasse={vorschlag?.sicherheit === "sicher" ? "btn" : "btn-hell"} className="flex flex-1 flex-wrap gap-2">
                <input type="hidden" name="umsatzId" value={u.id} />
                <select name="rechnungId" defaultValue={vorschlag?.rechnungId ?? ""} className="eingabe min-w-0 flex-1" aria-label="Rechnung">
                  <option value="">– Rechnung wählen –</option>
                  {kandidaten.map((k) => <option key={k.id} value={k.id}>{k.nummer} · {k.kunde} · offen {euro(k.offen)}</option>)}
                </select>
                <input name="skonto" defaultValue={vorschlag?.skonto ? vorschlag.skonto.toFixed(2).replace(".", ",") : ""} placeholder="Skonto €" className="eingabe w-24" aria-label="Skonto" />
              </AktionsFormular>
              <form action={uebergehenAktion}><input type="hidden" name="umsatzId" value={u.id} /><button className="btn-hell" title="Kein Kundenzahlungseingang">Übergehen</button></form>
            </div>
          </div>
        ))}
        {zeilen.length === 0 && <p className="px-4 py-6 text-center text-slate-500">Keine offenen Zahlungseingänge.</p>}
      </section>
    </div>
  );
}

import type { Geraet } from "@prisma/client";
import { n } from "@/lib/kalkulation";
import { isoTag } from "@/lib/formular";
import { KATEGORIE, STATUS } from "@/lib/geraete-texte";
import { geraetSpeichernAktion } from "./actions";

const zahl = (v: unknown) => (v == null ? "" : new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2, useGrouping: false }).format(n(v as number)));

export function GeraetFormular({ firmaId, g, lager }: { firmaId: string; g?: Geraet; lager: { id: string; name: string }[] }) {
  const f = (name: keyof Geraet & string, label: string, wert: unknown, extra: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={wert == null ? "" : String(wert)} className="eingabe" {...extra} />
    </div>
  );
  return (
    <form action={geraetSpeichernAktion} className="space-y-4">
      <input type="hidden" name="firmaId" value={firmaId} />
      {g && <input type="hidden" name="id" value={g.id} />}
      <div className="grid gap-3 md:grid-cols-6">
        {f("inventarNr", "Inventar-Nr.", g?.inventarNr, { required: true })}
        <div className="md:col-span-2">{f("bezeichnung", "Bezeichnung", g?.bezeichnung, { required: true, placeholder: "z. B. Minibagger 1,8 t" })}</div>
        <div>
          <label className="label" htmlFor="kategorie">Kategorie</label>
          <select id="kategorie" name="kategorie" defaultValue={g?.kategorie ?? "MASCHINE"} className="eingabe">
            {Object.entries(KATEGORIE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={g?.status ?? "VERFUEGBAR"} className="eingabe">
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="lagerId">Standort</label>
          <select id="lagerId" name="lagerId" defaultValue={g?.lagerId ?? ""} className="eingabe">
            <option value="">–</option>
            {lager.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {f("hersteller", "Hersteller", g?.hersteller)}
        {f("modell", "Modell", g?.modell)}
        {f("seriennummer", "Seriennummer", g?.seriennummer)}
        {f("kennzeichen", "Kennzeichen", g?.kennzeichen)}
        {f("baujahr", "Baujahr", g?.baujahr, { inputMode: "numeric" })}
        {f("betriebsstunden", "Betriebsstunden", zahl(g?.betriebsstunden), { inputMode: "decimal" })}
        {f("kmStand", "km-Stand", g?.kmStand, { inputMode: "numeric" })}
        <div className="md:col-span-5">{f("notiz", "Notiz", g?.notiz)}</div>
      </div>
      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">Maschinenkalkulation</legend>
        <div className="grid gap-3 md:grid-cols-5">
          {f("anschaffungAm", "Angeschafft am", isoTag(g?.anschaffungAm), { type: "date" })}
          {f("anschaffungspreis", "Anschaffungspreis €", zahl(g?.anschaffungspreis), { inputMode: "decimal" })}
          {f("nutzungsdauerJahre", "Nutzungsdauer Jahre", g?.nutzungsdauerJahre, { inputMode: "numeric" })}
          {f("einsatzstundenJahr", "Einsatzstunden je Jahr", g?.einsatzstundenJahr, { inputMode: "numeric" })}
          {f("zinsProzent", "Kalk. Zins %", zahl(g?.zinsProzent ?? 5), { inputMode: "decimal" })}
          {f("reparaturProzent", "Reparatur % / Jahr", zahl(g?.reparaturProzent ?? 8), { inputMode: "decimal" })}
          {f("fixkostenJahr", "Versicherung, Steuer € / Jahr", zahl(g?.fixkostenJahr ?? 0), { inputMode: "decimal" })}
          {f("betriebskostenStd", "Kraftstoff, Öl € / h", zahl(g?.betriebskostenStd ?? 0), { inputMode: "decimal" })}
          {f("verrechnungssatz", "Fester Satz € / h (optional)", zahl(g?.verrechnungssatz), { inputMode: "decimal" })}
        </div>
      </fieldset>
      <button className="btn">{g ? "Speichern" : "Gerät anlegen"}</button>
    </form>
  );
}

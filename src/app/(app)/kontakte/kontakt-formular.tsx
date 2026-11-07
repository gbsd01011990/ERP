import type { Kontakt, Adresse } from "@prisma/client";
import { kontaktSpeichern } from "../actions";

export function KontaktFormular({ kontakt }: { kontakt?: Kontakt & { adressen: Adresse[] } }) {
  const a = kontakt?.adressen.find((x) => x.art === "HAUPT");
  const feld = (name: string, label: string, wert?: string | null, typ = "text") => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={typ} defaultValue={wert ?? ""} className="eingabe" />
    </div>
  );
  return (
    <form action={kontaktSpeichern} className="karte mx-auto max-w-3xl space-y-4">
      <h1 className="h1">{kontakt ? "Kontakt bearbeiten" : "Neuer Kontakt"}</h1>
      {kontakt && <input type="hidden" name="id" value={kontakt.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Typ</label>
          <select name="typ" defaultValue={kontakt?.typ ?? "KUNDE"} className="eingabe">
            <option value="KUNDE">Kunde</option><option value="LIEFERANT">Lieferant</option><option value="PARTNER">Partner</option>
          </select>
        </div>
        <div>
          <label className="label">Kategorie</label>
          <select name="kategorie" defaultValue={kontakt?.kategorie ?? "PRIVAT"} className="eingabe">
            <option value="PRIVAT">Privat</option><option value="GEWERBE">Gewerbe</option><option value="OEFFENTLICH">Öffentliche Hand</option>
          </select>
        </div>
        <div className="sm:col-span-2">{feld("firmenname", "Firma / Behörde", kontakt?.firmenname)}</div>
        {feld("anrede", "Anrede", kontakt?.anrede)}
        <div />
        {feld("vorname", "Vorname", kontakt?.vorname)}
        {feld("nachname", "Nachname", kontakt?.nachname)}
        {feld("strasse", "Straße", a?.strasse)}
        <div className="grid grid-cols-3 gap-2">
          {feld("plz", "PLZ", a?.plz)}
          <div className="col-span-2">{feld("ort", "Ort", a?.ort)}</div>
        </div>
        {feld("telefon", "Telefon", kontakt?.telefon, "tel")}
        {feld("mobil", "Mobil", kontakt?.mobil, "tel")}
        {feld("email", "E-Mail", kontakt?.email, "email")}
        {feld("leitwegId", "Leitweg-ID (E-Rechnung)", kontakt?.leitwegId)}
        <div className="sm:col-span-2">
          <label className="label">Notiz</label>
          <textarea name="notiz" rows={3} defaultValue={kontakt?.notiz ?? ""} className="eingabe" />
        </div>
      </div>
      <button className="btn">Speichern</button>
    </form>
  );
}

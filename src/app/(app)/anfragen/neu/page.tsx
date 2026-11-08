import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { berlinTag, tagPlus } from "@/lib/zeit";
import { AktionsFormular } from "@/components/aktions-formular";
import { anfrageAktion } from "../../posteingang/actions";

/** Anfrage am Telefon erfassen: Kontakt, Projekt und Wiedervorlage in einem Schritt. */
export default async function NeueAnfrage() {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const mitarbeiter = await db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: b.mandant.id } } }, orderBy: { name: "asc" } });
  const feld = (name: string, label: string, extra: Record<string, unknown> = {}) => (
    <div><label className="label" htmlFor={name}>{label}</label><input id={name} name={name} className="eingabe" {...extra} /></div>
  );
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="h1">Neue Anfrage</h1>
      <p className="text-sm text-slate-600">
        Gibt es die E-Mail-Adresse schon in der Kundenkartei, wird der vorhandene Kontakt verwendet. Es entstehen ein Projekt im ersten Pipeline-Schritt
        und eine Wiedervorlage „Anfrage beantworten“.
      </p>
      <AktionsFormular aktion={anfrageAktion} knopf="Anfrage anlegen" className="karte grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="anrede">Anrede</label>
          <select id="anrede" name="anrede" className="eingabe">{["", "Frau", "Herr", "Familie"].map((a) => <option key={a} value={a}>{a || "–"}</option>)}</select>
        </div>
        {feld("firmenname", "Firma (optional)")}
        {feld("vorname", "Vorname")}
        {feld("nachname", "Nachname")}
        {feld("telefon", "Telefon", { type: "tel" })}
        {feld("email", "E-Mail", { type: "email" })}
        {feld("strasse", "Straße (Baustelle)")}
        <div className="grid grid-cols-3 gap-2">{feld("plz", "PLZ")}<div className="col-span-2">{feld("ort", "Ort")}</div></div>
        <div className="sm:col-span-2">{feld("titel", "Worum geht es?", { required: true, placeholder: "z. B. Baumfällung Garten, Heckenschnitt" })}</div>
        <div className="sm:col-span-2"><label className="label" htmlFor="anliegen">Notizen zum Gespräch</label><textarea id="anliegen" name="anliegen" rows={4} className="eingabe" /></div>
        <div>
          <label className="label" htmlFor="quelle">Quelle</label>
          <select id="quelle" name="quelle" defaultValue="Telefon" className="eingabe">
            {["Telefon", "Website", "Empfehlung", "Bestandskunde", "Ausschreibung", "Sonstiges"].map((q) => <option key={q}>{q}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="wiedervorlageTag">Wiedervorlage</label><input id="wiedervorlageTag" name="wiedervorlageTag" type="date" defaultValue={tagPlus(berlinTag(new Date()), 1)} className="eingabe" /></div>
          <div>
            <label className="label" htmlFor="zustaendigId">Zuständig</label>
            <select id="zustaendigId" name="zustaendigId" defaultValue={b.id} className="eingabe">{mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          </div>
        </div>
      </AktionsFormular>
    </div>
  );
}

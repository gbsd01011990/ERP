import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { firmenFilter } from "@/lib/firma";
import { kontaktName } from "@/lib/format";
import { projektAnlegen } from "../../actions";

type Props = { searchParams: Promise<{ kontakt?: string }> };

export default async function NeuesProjekt({ searchParams }: Props) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const { aktiv } = await firmenFilter(b);
  const { kontakt } = await searchParams;
  const firmen = b.zugriffe.map((z) => z.firma);
  const [kontakte, typen] = await Promise.all([
    db.kontakt.findMany({ where: { geloescht: false, typ: "KUNDE" }, orderBy: [{ nachname: "asc" }, { firmenname: "asc" }], take: 2000 }),
    db.projektTyp.findMany({ where: { firmaId: { in: firmen.map((f) => f.id) } }, include: { firma: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <form action={projektAnlegen} className="karte mx-auto max-w-3xl space-y-4">
      <h1 className="h1">Neues Projekt</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Firma</label>
          <select name="firmaId" defaultValue={aktiv === "alle" ? firmen[0]?.id : aktiv} className="eingabe" required>
            {firmen.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Projekttyp</label>
          <select name="typId" className="eingabe">
            <option value="">–</option>
            {typen.map((t) => <option key={t.id} value={t.id}>{t.firma.kuerzel}: {t.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Titel</label>
          <input name="titel" required className="eingabe" placeholder="z. B. Neuanlage Vorgarten" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Kunde</label>
          <select name="kontaktId" defaultValue={kontakt} required className="eingabe">
            <option value="">Bitte wählen …</option>
            {kontakte.map((k) => <option key={k.id} value={k.id}>{kontaktName(k)}{k.nummer ? ` (${k.nummer})` : ""}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">Neuer Kunde? Zuerst unter Kontakte anlegen.</p>
        </div>
        <div><label className="label">Straße Baustelle</label><input name="baustelleStrasse" className="eingabe" /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="label">PLZ</label><input name="baustellePlz" className="eingabe" /></div>
          <div className="col-span-2"><label className="label">Ort</label><input name="baustelleOrt" className="eingabe" /></div>
        </div>
        <div>
          <label className="label">Quelle</label>
          <select name="quelle" className="eingabe">
            {["", "Empfehlung", "Website", "Telefon", "Bestandskunde", "Ausschreibung", "Sonstiges"].map((q) => <option key={q} value={q}>{q || "–"}</option>)}
          </select>
        </div>
        <div><label className="label">Geschätztes Volumen (€)</label><input name="volumen" inputMode="decimal" className="eingabe" /></div>
        <div className="sm:col-span-2"><label className="label">Beschreibung</label><textarea name="beschreibung" rows={4} className="eingabe" /></div>
      </div>
      <button className="btn">Projekt anlegen</button>
    </form>
  );
}

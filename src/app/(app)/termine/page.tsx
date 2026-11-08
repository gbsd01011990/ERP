import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { kontaktName } from "@/lib/format";
import { slotText } from "@/lib/agent/zeiten";
import { berlinTag, berlinUhrzeit } from "@/lib/zeit";
import { AktionsFormular } from "@/components/aktions-formular";
import { terminAktion, absagenAktion } from "./actions";

const ART = { BESICHTIGUNG: "Besichtigung", RUECKRUF: "Rückruf", BERATUNG: "Beratung", AUSFUEHRUNG: "Ausführung", SONSTIGES: "Sonstiges" } as const;

export default async function Termine() {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const [termine, mitarbeiter] = await Promise.all([
    db.termin.findMany({
      where: { firmaId: b.mandant.id, ende: { gte: heute } }, orderBy: { beginn: "asc" }, take: 200,
      include: { kontakt: true, projekt: { select: { id: true, nummer: true } }, zustaendig: { select: { name: true } } },
    }),
    db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: b.mandant.id } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="h1">Termine</h1>
      <section className="karte">
        <h2 className="mb-3 font-semibold">Termin eintragen</h2>
        <AktionsFormular aktion={terminAktion} knopf="Eintragen" zuruecksetzen className="grid gap-3 md:grid-cols-6">
          <div><label className="label">Tag</label><input type="date" name="tag" required defaultValue={berlinTag(new Date())} className="eingabe" /></div>
          <div><label className="label">Uhrzeit</label><input type="time" name="uhrzeit" required defaultValue="09:00" className="eingabe" /></div>
          <div><label className="label">Dauer min</label><input name="dauer" defaultValue="60" className="eingabe" /></div>
          <div><label className="label">Art</label><select name="art" className="eingabe">{Object.entries(ART).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="md:col-span-2"><label className="label">Titel</label><input name="titel" required className="eingabe" /></div>
          <div className="md:col-span-2"><label className="label">Ort</label><input name="ort" className="eingabe" /></div>
          <div><label className="label">Projektnummer</label><input name="projektnummer" className="eingabe" /></div>
          <div><label className="label">Zuständig</label><select name="zustaendigId" defaultValue={b.id} className="eingabe">{mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div className="md:col-span-2"><label className="label">Notiz</label><input name="notiz" className="eingabe" /></div>
        </AktionsFormular>
      </section>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Wann</th><th>Art</th><th>Titel</th><th>Ort</th><th>Kunde / Projekt</th><th>Zuständig</th><th>Quelle</th><th /></tr></thead>
          <tbody>
            {termine.map((t) => (
              <tr key={t.id} className={t.abgesagt ? "text-slate-400 line-through" : ""}>
                <td className="whitespace-nowrap">{slotText(t.beginn).replace(" um ", ", ")}–{berlinUhrzeit(t.ende)}</td>
                <td>{ART[t.art]}</td>
                <td>{t.titel}{t.notiz && <span className="block text-xs text-slate-500">{t.notiz}</span>}</td>
                <td>{t.ort}</td>
                <td>{t.kontakt ? kontaktName(t.kontakt) : ""}{t.projekt && <> · <Link href={`/projekte/${t.projekt.id}`} className="text-marke">{t.projekt.nummer}</Link></>}</td>
                <td>{t.zustaendig?.name}</td>
                <td>{t.quelle}</td>
                <td><form action={absagenAktion}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-marke">{t.abgesagt ? "wieder aktiv" : "absagen"}</button></form></td>
              </tr>
            ))}
            {termine.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-500">Keine anstehenden Termine.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

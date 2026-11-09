import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { euro, kontaktName, datumZeit } from "@/lib/format";
import { AufgabenListe, aufgabeInclude } from "@/components/aufgaben-liste";
import { AufgabeFormular } from "@/components/aufgabe-formular";
import { kontaktNotizAktion } from "../../posteingang/actions";

const ART = { NOTIZ: "Notiz", ANRUF: "Anruf", EMAIL: "E-Mail", TERMIN: "Termin", STATUS: "Status", SYSTEM: "System" } as const;
type Ereignis = { zeit: Date; art: string; text: string; wer?: string | null; link?: string; projekt?: string };

const KAT = { PRIVAT: "Privat", GEWERBE: "Gewerbe", OEFFENTLICH: "Öffentliche Hand" } as const;
const ADR = { HAUPT: "Hauptadresse", RECHNUNG: "Rechnung", BAUSTELLE: "Baustelle", SONSTIGE: "Sonstige" } as const;

export default async function KontaktSeite({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht();
  const { id } = await params;
  const k = await db.kontakt.findUnique({
    where: { id },
    include: {
      adressen: true,
      ansprechpartner: true,
      projekte: { where: { firmaId: { in: firmenIds(b) } }, include: { status: true, firma: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!k) notFound();
  const buero = b.rolle !== "KOLONNE";
  const projektIds = k.projekte.map((p) => p.id);
  const [notizen, projektLog, mails, aufgaben, mitarbeiter] = await Promise.all([
    db.logbuchEintrag.findMany({ where: { kontaktId: k.id, firmaId: b.mandant.id }, include: { benutzer: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.logbuchEintrag.findMany({ where: { projektId: { in: projektIds }, art: { not: "SYSTEM" } }, include: { benutzer: { select: { name: true } }, projekt: { select: { nummer: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    buero ? db.email.findMany({ where: { kontaktId: k.id, firmaId: b.mandant.id }, orderBy: { empfangenAm: "desc" }, take: 100 }) : [],
    db.aufgabe.findMany({ where: { kontaktId: k.id, firmaId: b.mandant.id, erledigtAm: null }, include: aufgabeInclude, orderBy: [{ faelligAm: { sort: "asc", nulls: "last" } }] }),
    db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: b.mandant.id } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  // Zeitleiste: Notizen, Projekt-Logbuch (ohne Systemeinträge) und E-Mails, neueste zuerst
  const zeitleiste: Ereignis[] = [
    ...notizen.map((n) => ({ zeit: n.createdAt, art: ART[n.art], text: n.text, wer: n.benutzer?.name })),
    ...projektLog.filter((l) => l.art !== "EMAIL").map((l) => ({ zeit: l.createdAt, art: ART[l.art], text: l.text, wer: l.benutzer?.name, projekt: l.projekt?.nummer, link: `/projekte/${l.projektId}` })),
    ...mails.map((m) => ({ zeit: m.empfangenAm, art: m.richtung === "AUSGANG" ? "E-Mail →" : "E-Mail ←", text: m.betreff, wer: m.richtung === "AUSGANG" ? m.vonAdresse : m.vonName ?? m.vonAdresse, link: `/posteingang/${m.id}` })),
  ].sort((a, c) => c.zeit.getTime() - a.zeit.getTime()).slice(0, 150);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500">{KAT[k.kategorie]}{k.nummer ? ` · ${k.nummer}` : ""}</div>
          <h1 className="h1">{kontaktName(k)}</h1>
          {k.firmenname && (k.vorname || k.nachname) && <div className="text-sm">{[k.anrede, k.vorname, k.nachname].filter(Boolean).join(" ")}</div>}
        </div>
        <div className="ml-auto flex gap-2">
          <Link href={`/kontakte/${k.id}/bearbeiten`} className="btn-hell">Bearbeiten</Link>
          <Link href={`/projekte/neu?kontakt=${k.id}`} className="btn">+ Projekt</Link>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="karte space-y-1 text-sm">
          <h2 className="mb-1 font-semibold">Kontaktdaten</h2>
          {k.telefon && <div>Tel. <a href={`tel:${k.telefon}`}>{k.telefon}</a></div>}
          {k.mobil && <div>Mobil <a href={`tel:${k.mobil}`}>{k.mobil}</a></div>}
          {k.email && <div><a href={`mailto:${k.email}`} className="text-marke">{k.email}</a></div>}
          {k.leitwegId && <div>Leitweg-ID: {k.leitwegId}</div>}
          {k.ustId && <div>USt-IdNr.: {k.ustId}</div>}
          {k.notiz && <p className="whitespace-pre-line pt-2 text-slate-600">{k.notiz}</p>}
        </section>
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Adressen</h2>
          {k.adressen.map((a) => (
            <div key={a.id}><span className="text-xs uppercase text-slate-500">{ADR[a.art]}</span><br />{a.strasse}<br />{a.plz} {a.ort}</div>
          ))}
          {k.adressen.length === 0 && <div className="text-slate-500">Keine Adresse hinterlegt.</div>}
        </section>
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Ansprechpartner</h2>
          {k.ansprechpartner.map((a) => (
            <div key={a.id}>{a.name}{a.funktion ? ` (${a.funktion})` : ""}<br />{a.telefon} {a.email}</div>
          ))}
          {k.ansprechpartner.length === 0 && <div className="text-slate-500">Keine Ansprechpartner.</div>}
        </section>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <section className="karte space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Zeitleiste</h2>
            {buero && k.email && <Link href={`/posteingang/schreiben?kontakt=${k.id}`} className="btn-hell ml-auto py-1">E-Mail schreiben</Link>}
          </div>
          {buero && (
            <form action={kontaktNotizAktion} className="flex flex-wrap gap-2">
              <input type="hidden" name="kontaktId" value={k.id} />
              <select name="art" className="eingabe w-auto" aria-label="Art">{(["NOTIZ", "ANRUF", "TERMIN"] as const).map((a) => <option key={a} value={a}>{ART[a]}</option>)}</select>
              <input name="text" required placeholder="z. B. Rückruf: möchte Angebot bis Freitag" className="eingabe min-w-0 flex-1" aria-label="Eintrag" />
              <button className="btn">Speichern</button>
            </form>
          )}
          <ul className="divide-y divide-slate-100 text-sm">
            {zeitleiste.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 py-2">
                <span className="w-28 shrink-0 text-slate-400">{datumZeit(e.zeit)}</span>
                <span className="w-20 shrink-0 text-xs uppercase text-slate-500">{e.art}</span>
                <span className="min-w-0 flex-1">
                  {e.projekt && <span className="mr-1 rounded bg-marke-hell px-1 text-xs text-marke-dunkel">{e.projekt}</span>}
                  {e.link ? <Link href={e.link} className="hover:text-marke">{e.text}</Link> : <span className="whitespace-pre-line">{e.text}</span>}
                </span>
                <span className="text-slate-400">{e.wer}</span>
              </li>
            ))}
            {zeitleiste.length === 0 && <li className="py-2 text-slate-500">Noch keine Einträge.</li>}
          </ul>
        </section>
        <section className="karte space-y-3">
          <h2 className="font-semibold">Aufgaben</h2>
          <AufgabenListe aufgaben={aufgaben} />
          {buero && <AufgabeFormular mitarbeiter={mitarbeiter} ichId={b.id} kontaktId={k.id} />}
        </section>
      </div>
      <section className="karte overflow-x-auto p-0">
        <h2 className="px-4 pt-4 font-semibold">Projekte</h2>
        <table className="tabelle">
          <thead><tr><th>Nr.</th><th>Titel</th><th>Firma</th><th>Status</th><th className="text-right">Volumen</th></tr></thead>
          <tbody>
            {k.projekte.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/projekte/${p.id}`} className="font-medium text-marke">{p.nummer}</Link></td>
                <td>{p.titel}</td>
                <td>{p.firma.kuerzel}</td>
                <td><span className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: p.status.farbe }}>{p.status.name}</span></td>
                <td className="text-right">{euro(p.volumen)}</td>
              </tr>
            ))}
            {k.projekte.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500">Keine Projekte.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

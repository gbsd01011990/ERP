import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { euro, kontaktName } from "@/lib/format";

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

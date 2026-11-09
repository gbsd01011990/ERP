import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit, kontaktName } from "@/lib/format";
import { slotText } from "@/lib/agent/zeiten";
import { AktionsFormular } from "@/components/aktions-formular";
import { erledigtAktion, zuordnenAktion, antwortAktion } from "../actions";
import { KANAL_TEXT } from "@/lib/dienste/kanaele";

const VON = { KUNDE: "Kunde", AGENT: "Agent", MITARBEITER: "Mitarbeiter", WERKZEUG: "ERP" } as Record<string, string>;

export default async function Gespraech({ params }: { params: Promise<{ id: string }> }) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const g = await db.gespraech.findUnique({
    where: { id: (await params).id },
    include: { nachrichten: { orderBy: { zeit: "asc" } }, kontakt: true, projekt: true, termine: true, zustaendig: { select: { name: true } } },
  });
  if (!g || g.firmaId !== b.mandant.id) notFound();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-sm text-slate-500"><Link href="/anrufe" className="text-marke">Kommunikation</Link> · {KANAL_TEXT[g.kanal]}</div>
          <h1 className="h1">{g.absenderName ?? g.absender}</h1>
          <div className="text-sm text-slate-500">{datumZeit(g.beginn)}{g.dauerSek ? ` · ${Math.round(g.dauerSek / 60)} min` : ""} · {g.absender}{g.zustaendig ? ` · zuständig ${g.zustaendig.name}` : ""}</div>
        </div>
        <form action={erledigtAktion} className="ml-auto"><input type="hidden" name="id" value={g.id} /><button className={g.status === "OFFEN" ? "btn" : "btn-hell"}>{g.status === "OFFEN" ? "Erledigt" : "Wieder öffnen"}</button></form>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="karte space-y-2 text-sm lg:col-span-2">
          <h2 className="font-semibold">Zusammenfassung</h2>
          <p className="whitespace-pre-line">{g.zusammenfassung ?? g.anliegen ?? "Noch keine Zusammenfassung (Gespräch läuft oder Webhook fehlt)."}</p>
          {g.ergebnis && <p><b>Ergebnis:</b> {g.ergebnis}{g.dringend ? " · dringend" : ""}</p>}
          {g.aufnahmeUrl && <audio controls src={g.aufnahmeUrl} className="w-full" />}
        </section>
        <section className="karte space-y-2 text-sm">
          <h2 className="font-semibold">Zuordnung</h2>
          {g.kontakt ? <div>Kunde: <Link href={`/kontakte/${g.kontakt.id}`} className="text-marke">{kontaktName(g.kontakt)}</Link></div> : <div className="text-amber-700">Kein Kunde erkannt.</div>}
          {g.projekt && <div>Projekt: <Link href={`/projekte/${g.projekt.id}`} className="text-marke">{g.projekt.nummer} {g.projekt.titel}</Link></div>}
          {g.termine.map((t) => <div key={t.id}>Termin: {slotText(t.beginn)} ({t.titel})</div>)}
          <AktionsFormular aktion={zuordnenAktion} knopf="Zuordnen" knopfKlasse="btn-hell" className="flex flex-wrap gap-2 pt-2">
            <input type="hidden" name="id" value={g.id} />
            <input name="projektnummer" placeholder="Projektnummer, z. B. GB-012" className="eingabe flex-1" aria-label="Projektnummer" />
          </AktionsFormular>
        </section>
      </div>
      <section className="karte text-sm">
        <h2 className="mb-2 font-semibold">Verlauf</h2>
        <ul className="space-y-2">
          {g.nachrichten.map((n) => (
            <li key={n.id} className={`flex gap-3 ${n.von === "WERKZEUG" ? "text-xs text-slate-500" : ""}`}>
              <span className="w-20 shrink-0 text-slate-400">{VON[n.von] ?? n.von}</span>
              <span className={`flex-1 whitespace-pre-line rounded px-2 py-1 ${n.von === "KUNDE" ? "bg-slate-100" : n.von === "AGENT" || n.von === "MITARBEITER" ? "bg-marke-hell" : ""}`}>{n.text}</span>
              <span className="w-24 shrink-0 text-right text-xs text-slate-400">{datumZeit(n.zeit).split(", ")[1] ?? ""}</span>
            </li>
          ))}
          {g.nachrichten.length === 0 && <li className="text-slate-500">Kein Verlauf.</li>}
        </ul>
        {g.kanal !== "TELEFON" && (
          <AktionsFormular aktion={antwortAktion} knopf={`Per ${KANAL_TEXT[g.kanal]} senden`} zuruecksetzen className="mt-4 grid gap-2">
            <input type="hidden" name="id" value={g.id} />
            <textarea name="text" rows={3} required placeholder="Antwort …" className="eingabe" aria-label="Antwort" />
          </AktionsFormular>
        )}
      </section>
    </div>
  );
}

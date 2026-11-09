import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit } from "@/lib/format";

const KANAL = { TELEFON: "Telefon", WHATSAPP: "WhatsApp", TELEGRAM: "Telegram", SMS: "SMS", THREEMA: "Threema" } as const;

export default async function Anrufe({ searchParams }: { searchParams: Promise<{ alle?: string }> }) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const { alle } = await searchParams;
  const liste = await db.gespraech.findMany({
    where: { firmaId: b.mandant.id, ...(alle ? {} : { status: "OFFEN" }) },
    orderBy: { beginn: "desc" }, take: 300,
    include: { projekt: { select: { nummer: true } }, zustaendig: { select: { name: true } } },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="h1">Kommunikation</h1>
        <span className="text-sm text-slate-500">Anrufe des Telefonagenten und Nachrichten aus WhatsApp, Telegram und SMS.</span>
        <Link href={alle ? "/anrufe" : "/anrufe?alle=1"} className="btn-hell ml-auto">{alle ? "Nur offene" : "Alle zeigen"}</Link>
      </div>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Wann</th><th>Kanal</th><th>Von</th><th>Anliegen</th><th>Ergebnis</th><th>Projekt</th><th>Zuständig</th></tr></thead>
          <tbody>
            {liste.map((g) => (
              <tr key={g.id} className={`hover:bg-slate-50 ${g.status === "ERLEDIGT" ? "text-slate-400" : ""}`}>
                <td className="whitespace-nowrap"><Link href={`/anrufe/${g.id}`} className="text-marke">{datumZeit(g.beginn)}</Link></td>
                <td>{KANAL[g.kanal]}</td>
                <td>{g.absenderName ?? g.absender}{g.dringend && <span className="ml-2 rounded bg-red-100 px-1 text-xs text-red-700">dringend</span>}</td>
                <td className="max-w-md truncate">{g.anliegen ?? g.zusammenfassung ?? "–"}</td>
                <td>{g.ergebnis ?? <span className="text-amber-700">prüfen</span>}</td>
                <td>{g.projekt?.nummer ?? ""}</td>
                <td>{g.zustaendig?.name ?? ""}</td>
              </tr>
            ))}
            {liste.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Keine {alle ? "" : "offenen "}Gespräche.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

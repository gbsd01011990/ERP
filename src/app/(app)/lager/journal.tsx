import Link from "next/link";
import { db } from "@/lib/db";
import { n } from "@/lib/kalkulation";
import { datumZeit, euro } from "@/lib/format";

export const BUCHUNGSART = { ZUGANG: "Zugang", ABGANG: "Abgang", UMBUCHUNG: "Umbuchung", PROJEKT: "Projekt", INVENTUR: "Inventur" } as const;
const zahl = (v: unknown) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n(v as number));

export async function Journal({ firmaId, artikelId }: { firmaId: string; artikelId?: string }) {
  const buchungen = await db.lagerBuchung.findMany({
    where: { artikel: { firmaId }, ...(artikelId ? { artikelId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { artikel: true, vonLager: true, nachLager: true, projekt: true, benutzer: { select: { name: true } } },
  });
  return <JournalTabelle buchungen={buchungen} />;
}

type JB = Awaited<ReturnType<typeof db.lagerBuchung.findMany<{ include: { artikel: true; vonLager: true; nachLager: true; projekt: true; benutzer: { select: { name: true } } } }>>>;
function JournalTabelle({ buchungen }: { buchungen: JB }) {
  return (
    <div className="karte overflow-x-auto p-0">
      <table className="tabelle">
        <thead><tr><th>Zeit</th><th>Art</th><th>Artikel</th><th className="text-right">Menge</th><th>Von → Nach</th><th>Projekt</th><th className="text-right">Wert</th><th>Beleg / Notiz</th><th>Wer</th></tr></thead>
        <tbody>
          {buchungen.map((x) => (
            <tr key={x.id}>
              <td className="whitespace-nowrap">{datumZeit(x.createdAt)}</td>
              <td>{BUCHUNGSART[x.art]}</td>
              <td><Link href={`/lager/artikel/${x.artikelId}`} className="text-marke">{x.artikel.bezeichnung}</Link></td>
              <td className="text-right">{zahl(x.menge)} {x.artikel.einheit}</td>
              <td className="whitespace-nowrap">{x.vonLager?.name ?? ""}{x.vonLager && x.nachLager ? " → " : ""}{x.nachLager?.name ?? ""}</td>
              <td>{x.projekt ? <Link href={`/projekte/${x.projektId}`} className="text-marke">{x.projekt.nummer}</Link> : ""}</td>
              <td className="text-right">{euro(x.wert)}</td>
              <td className="text-slate-600">{[x.beleg, x.notiz].filter(Boolean).join(" · ")}</td>
              <td className="text-slate-500">{x.benutzer?.name}</td>
            </tr>
          ))}
          {buchungen.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-slate-500">Keine Buchungen.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

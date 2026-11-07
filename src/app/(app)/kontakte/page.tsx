import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { kontaktName } from "@/lib/format";
import type { Prisma } from "@prisma/client";

type Props = { searchParams: Promise<{ q?: string; typ?: string }> };

export default async function Kontakte({ searchParams }: Props) {
  await benutzerPflicht();
  const { q, typ } = await searchParams;
  const where: Prisma.KontaktWhereInput = {
    geloescht: false,
    ...(typ ? { typ: typ as Prisma.EnumKontaktTypFilter["equals"] } : {}),
    ...(q
      ? {
          OR: [
            { nachname: { contains: q, mode: "insensitive" } },
            { vorname: { contains: q, mode: "insensitive" } },
            { firmenname: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { nummer: { contains: q, mode: "insensitive" } },
            { adressen: { some: { OR: [{ ort: { contains: q, mode: "insensitive" } }, { strasse: { contains: q, mode: "insensitive" } }] } } },
          ],
        }
      : {}),
  };
  const kontakte = await db.kontakt.findMany({
    where,
    orderBy: [{ nachname: "asc" }, { firmenname: "asc" }],
    take: 300,
    include: { adressen: { where: { art: "HAUPT" }, take: 1 }, _count: { select: { projekte: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Kontakte</h1>
        <Link href="/kontakte/neu" className="btn ml-auto">+ Kontakt</Link>
      </div>
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Name, Firma, Ort, E-Mail" className="eingabe max-w-md" />
        <select name="typ" defaultValue={typ ?? ""} className="eingabe w-auto">
          <option value="">Alle Typen</option><option value="KUNDE">Kunden</option><option value="LIEFERANT">Lieferanten</option><option value="PARTNER">Partner</option>
        </select>
        <button className="btn-hell">Suchen</button>
      </form>
      <div className="karte overflow-x-auto p-0">
        <table className="tabelle">
          <thead><tr><th>Name</th><th>Ort</th><th>Telefon</th><th>E-Mail</th><th className="text-right">Projekte</th></tr></thead>
          <tbody>
            {kontakte.map((k) => (
              <tr key={k.id} className="hover:bg-slate-50">
                <td><Link href={`/kontakte/${k.id}`} className="font-medium text-marke">{kontaktName(k)}</Link></td>
                <td>{k.adressen[0]?.ort ?? "–"}</td>
                <td>{k.telefon ?? k.mobil ?? "–"}</td>
                <td>{k.email ?? "–"}</td>
                <td className="text-right">{k._count.projekte}</td>
              </tr>
            ))}
            {kontakte.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-500">Keine Kontakte gefunden.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

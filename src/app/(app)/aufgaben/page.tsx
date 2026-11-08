import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { AufgabenListe, aufgabeInclude } from "@/components/aufgaben-liste";
import { AufgabeFormular } from "@/components/aufgabe-formular";

type Props = { searchParams: Promise<{ ansicht?: string }> };
const ANSICHTEN = { meine: "Meine offenen", alle: "Alle offenen", erledigt: "Erledigt" } as const;

export default async function Aufgaben({ searchParams }: Props) {
  const b = await benutzerPflicht();
  const sp = await searchParams;
  const kolonne = b.rolle === "KOLONNE";
  const ansicht = (sp.ansicht && sp.ansicht in ANSICHTEN && !kolonne ? sp.ansicht : "meine") as keyof typeof ANSICHTEN;
  const where: Prisma.AufgabeWhereInput = {
    firmaId: b.mandant.id,
    ...(ansicht === "erledigt" ? { erledigtAm: { not: null } } : { erledigtAm: null }),
    ...(ansicht === "meine" || kolonne ? { zustaendigId: b.id } : {}),
  };
  const [aufgaben, mitarbeiter] = await Promise.all([
    db.aufgabe.findMany({
      where, include: aufgabeInclude, take: 300,
      orderBy: ansicht === "erledigt" ? [{ erledigtAm: "desc" }] : [{ faelligAm: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    }),
    db.benutzer.findMany({ where: { aktiv: true, zugriffe: { some: { firmaId: b.mandant.id } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="h1">Aufgaben</h1>
      {!kolonne && (
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(ANSICHTEN).map(([k, v]) => <Link key={k} href={`/aufgaben?ansicht=${k}`} className={ansicht === k ? "btn" : "btn-hell"}>{v}</Link>)}
        </div>
      )}
      {!kolonne && <section className="karte"><AufgabeFormular mitarbeiter={mitarbeiter} ichId={b.id} /></section>}
      <section className="karte"><AufgabenListe aufgaben={aufgaben} leer={ansicht === "erledigt" ? "Noch nichts erledigt." : "Keine offenen Aufgaben."} /></section>
    </div>
  );
}

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit, kontaktName } from "@/lib/format";
import { emailFilter, meinePostfaecher } from "@/lib/dienste/mail";
import { AktionsFormular } from "@/components/aktions-formular";
import { abrufenAktion } from "./actions";

type Props = { searchParams: Promise<{ ansicht?: string; q?: string; postfach?: string }> };

const ANSICHTEN = { offen: "Nicht zugeordnet", alle: "Alle", gesendet: "Gesendet", ignoriert: "Ausgeblendet" } as const;

export default async function Posteingang({ searchParams }: Props) {
  const b = await benutzerPflicht();
  const sp = await searchParams;
  const ansicht = (sp.ansicht && sp.ansicht in ANSICHTEN ? sp.ansicht : "offen") as keyof typeof ANSICHTEN;
  const postfaecher = await meinePostfaecher(b);

  const bedingung: Prisma.EmailWhereInput = {
    offen: { richtung: "EINGANG" as const, kontaktId: null, projektId: null, ignoriert: false },
    alle: { ignoriert: false },
    gesendet: { richtung: "AUSGANG" as const },
    ignoriert: { ignoriert: true },
  }[ansicht];
  const where: Prisma.EmailWhereInput = {
    AND: [
      await emailFilter(b),
      bedingung,
      ...(sp.postfach ? [{ postfachId: sp.postfach }] : []),
      ...(sp.q ? [{ OR: [{ betreff: { contains: sp.q, mode: "insensitive" as const } }, { vonAdresse: { contains: sp.q, mode: "insensitive" as const } }, { vonName: { contains: sp.q, mode: "insensitive" as const } }, { text: { contains: sp.q, mode: "insensitive" as const } }] }] : []),
    ],
  };
  const [mails, offen] = await Promise.all([
    db.email.findMany({ where, orderBy: { empfangenAm: "desc" }, take: 200, include: { kontakt: true, projekt: true, postfach: true } }),
    db.email.count({ where: { AND: [await emailFilter(b), { richtung: "EINGANG", kontaktId: null, projektId: null, ignoriert: false }] } }),
  ]);
  const q = (p: Record<string, string | undefined>) => `/posteingang?${new URLSearchParams(Object.entries({ ansicht, q: sp.q, postfach: sp.postfach, ...p }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Posteingang</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {postfaecher.length > 0 && <AktionsFormular aktion={abrufenAktion} knopf="Jetzt abrufen" knopfKlasse="btn-hell" className="flex" />}
          {b.rolle !== "KOLONNE" && <Link href="/anfragen/neu" className="btn-hell">+ Anfrage (Telefon)</Link>}
          {postfaecher.length > 0 && <Link href="/posteingang/schreiben" className="btn">+ Neue E-Mail</Link>}
        </div>
      </div>

      {postfaecher.length === 0 && (
        <p className="karte text-sm text-slate-600">
          Dir ist noch kein Postfach zugewiesen. {b.rolle === "ADMIN" ? <Link href="/einstellungen/postfaecher" className="text-marke">Postfächer einrichten</Link> : "Bitte an einen Admin wenden."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {Object.entries(ANSICHTEN).map(([k, v]) => (
          <Link key={k} href={q({ ansicht: k })} className={ansicht === k ? "btn" : "btn-hell"}>{v}{k === "offen" && offen ? ` (${offen})` : ""}</Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="ansicht" value={ansicht} />
          {postfaecher.length > 1 && (
            <select name="postfach" defaultValue={sp.postfach ?? ""} className="eingabe w-auto">
              <option value="">Alle Postfächer</option>
              {postfaecher.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.adresse}</option>)}
            </select>
          )}
          <input name="q" defaultValue={sp.q} placeholder="Suche" className="eingabe w-48" />
          <button className="btn-hell">Suchen</button>
        </form>
      </div>

      <div className="karte p-0">
        <ul className="divide-y divide-slate-100">
          {mails.map((m) => (
            <li key={m.id}>
              <Link href={`/posteingang/${m.id}`} className={`grid gap-x-4 px-4 py-2 text-sm hover:bg-slate-50 md:grid-cols-[8rem_14rem_1fr_auto] ${m.gelesen ? "" : "font-semibold"}`}>
                <span className="text-slate-500">{datumZeit(m.empfangenAm)}</span>
                <span className="truncate">{m.richtung === "AUSGANG" ? `an ${m.an[0] ?? ""}` : m.vonName || m.vonAdresse}</span>
                <span className="min-w-0">
                  <span className="block truncate">{m.betreff}{m.hatAnhaenge ? " 📎" : ""}</span>
                  <span className="block truncate text-xs font-normal text-slate-500">{m.vorschau}</span>
                </span>
                <span className="flex flex-wrap items-start gap-1 text-xs font-normal">
                  {m.projekt && <span className="rounded bg-marke-hell px-1.5 py-0.5 text-marke-dunkel">{m.projekt.nummer}</span>}
                  {m.kontakt && !m.projekt && <span className="rounded bg-slate-100 px-1.5 py-0.5">{kontaktName(m.kontakt)}</span>}
                  {postfaecher.length > 1 && <span className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-500">{m.postfach.name ?? m.postfach.adresse.split("@")[0]}</span>}
                </span>
              </Link>
            </li>
          ))}
          {mails.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">{ansicht === "offen" ? "Alles zugeordnet." : "Keine E-Mails."}</li>}
        </ul>
      </div>
    </div>
  );
}

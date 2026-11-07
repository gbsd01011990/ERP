import Link from "next/link";
import { benutzerPflicht } from "@/lib/auth";
import { firmenFilter } from "@/lib/firma";
import { logoutAktion } from "../login/actions";
import { FirmenWahl } from "./firmen-wahl";

const NAV = [
  { href: "/", text: "Übersicht" },
  { href: "/projekte", text: "Projekte" },
  { href: "/angebote", text: "Angebote" },
  { href: "/kontakte", text: "Kontakte" },
  { href: "/leistungen", text: "Leistungen" },
  { href: "/einstellungen/api", text: "API" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const b = await benutzerPflicht();
  const { aktiv } = await firmenFilter(b);
  const firmen = b.zugriffe.map((z) => ({ id: z.firma.id, kuerzel: z.firma.kuerzel, name: z.firma.name }));

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold text-marke">ERP</Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-slate-600 hover:text-marke">{n.text}</Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3 text-sm">
            <FirmenWahl firmen={firmen} aktiv={aktiv} />
            <span className="hidden text-slate-500 sm:inline">{b.name}</span>
            <form action={logoutAktion}><button className="text-slate-500 hover:text-red-600">Abmelden</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

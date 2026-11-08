import Image from "next/image";
import Link from "next/link";
import { benutzerPflicht } from "@/lib/auth";
import { mandantNachKuerzel, markenStil } from "@/lib/mandanten";
import { logoutAktion, mandantWechseln } from "../login/actions";

const NAV = [
  { href: "/", text: "Übersicht" },
  { href: "/projekte", text: "Projekte" },
  { href: "/angebote", text: "Angebote" },
  { href: "/kontakte", text: "Kontakte" },
  { href: "/leistungen", text: "Leistungen", buero: true },
  { href: "/lager", text: "Lager" },
  { href: "/geraete", text: "Geräte" },
  { href: "/plankosten", text: "Plankosten", nurAdmin: true },
  { href: "/einstellungen/api", text: "API", buero: true },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const b = await benutzerPflicht();
  const m = mandantNachKuerzel(b.mandant.kuerzel);

  return (
    <div className="min-h-screen" style={markenStil(m)}>
      <header className="border-b border-slate-200 bg-white">
        <div className="h-1 bg-marke" />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2" title={b.mandant.name}>
            {m ? (
              <Image src={m.logo} alt={b.mandant.name} width={m.logoBreite} height={m.logoHoehe} className="h-9 w-auto object-contain" priority />
            ) : (
              <span className="text-lg font-bold text-marke">{b.mandant.name}</span>
            )}
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV.filter((n) => (!("nurAdmin" in n) || b.rolle === "ADMIN") && (!("buero" in n) || b.rolle !== "KOLONNE")).map((n) => (
              <Link key={n.href} href={n.href} className="text-slate-600 hover:text-marke">{n.text}</Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">{b.name}</span>
            <Link href="/einstellungen/passwort" className="text-slate-500 hover:text-marke">Passwort ändern</Link>
            <form action={mandantWechseln}><button className="text-slate-500 hover:text-marke">Mandant wechseln</button></form>
            <form action={logoutAktion}><button className="text-slate-500 hover:text-red-600">Abmelden</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

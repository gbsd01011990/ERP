import { Suspense } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { mandantNachKuerzel, markenStil } from "@/lib/mandanten";
import { emailFilter } from "@/lib/dienste/mail";
import { berlinTag, berlinZuUtc, tagPlus } from "@/lib/zeit";
import { AppNavigation, type NavGruppe } from "@/components/app-navigation";
import { logoutAktion, mandantWechseln } from "../login/actions";

/** Zähler für die Navigation; ein Fehler hier darf die Seite nicht blockieren. */
async function zaehlerLaden(b: Awaited<ReturnType<typeof benutzerPflicht>>) {
  const firmaId = b.mandant.id;
  const buero = b.rolle !== "KOLONNE";
  const jetzt = new Date();
  const bisMorgen = berlinZuUtc(tagPlus(berlinTag(jetzt), 1));
  try {
    const [aufgaben, mails, gespraeche, eingang, radar] = await Promise.all([
      db.aufgabe.count({ where: { firmaId, zustaendigId: b.id, erledigtAm: null, faelligAm: { lt: bisMorgen } } }),
      db.email.count({ where: { AND: [await emailFilter(b), { richtung: "EINGANG", kontaktId: null, projektId: null, ignoriert: false }] } }),
      buero ? db.gespraech.count({ where: { firmaId, status: "OFFEN" } }) : 0,
      buero ? db.eingangsrechnung.count({ where: { firmaId, status: { in: ["NEU", "PRUEFUNG"] } } }) : 0,
      buero ? db.ausschreibungTreffer.count({ where: { firmaId, status: "NEU", ausschreibung: { OR: [{ frist: null }, { frist: { gte: jetzt } }] } } }) : 0,
    ]);
    return { aufgaben, mails, gespraeche, eingang, radar };
  } catch (e) {
    console.error("Navigationszähler:", e);
    return { aufgaben: 0, mails: 0, gespraeche: 0, eingang: 0, radar: 0 };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const b = await benutzerPflicht();
  const m = mandantNachKuerzel(b.mandant.kuerzel);
  const admin = b.rolle === "ADMIN";
  const buero = b.rolle !== "KOLONNE";
  const z = await zaehlerLaden(b);

  const gruppen: NavGruppe[] = [
    { titel: "", eintraege: [{ href: "/", text: "Übersicht" }] },
    {
      titel: "Vertrieb",
      eintraege: [
        ...(buero ? [{ href: "/ausschreibungen", text: "Ausschreibungen", zaehler: z.radar }] : []),
        { href: "/projekte", text: "Projekte" },
        { href: "/angebote", text: "Angebote" },
        { href: "/kontakte", text: "Kontakte" },
        ...(buero ? [{ href: "/leistungen", text: "Leistungen" }] : []),
        ...(buero ? [{ href: "/anfragen/neu", text: "Anfrage erfassen" }] : []),
      ],
    },
    {
      titel: "Kommunikation",
      eintraege: [
        { href: "/posteingang", text: "Posteingang", zaehler: z.mails },
        ...(buero ? [{ href: "/anrufe", text: "Anrufe & Messenger", zaehler: z.gespraeche }] : []),
        { href: "/aufgaben", text: "Aufgaben", zaehler: z.aufgaben, dringend: true },
        ...(buero ? [{ href: "/termine", text: "Termine" }] : []),
      ],
    },
    ...(buero ? [{
      titel: "Abrechnung",
      eintraege: [
        { href: "/rechnungen", text: "Rechnungen" },
        { href: "/rechnungen/offene-posten", text: "Offene Posten" },
        { href: "/rechnungen/bank", text: "Kontoauszug" },
        { href: "/rechnungen/datev", text: "DATEV-Export" },
      ],
    }] : []),
    {
      titel: "Einkauf",
      eintraege: [
        ...(buero ? [{ href: "/einkauf", text: "Eingangsrechnungen", zaehler: z.eingang }] : []),
        { href: "/einkauf?ansicht=bestellungen", text: "Bestellungen" },
        { href: "/einkauf/lieferscheine", text: "Lieferscheine" },
      ],
    },
    {
      titel: "Betrieb",
      eintraege: [
        { href: "/zeiten", text: "Zeiten" },
        { href: "/lager", text: "Lager" },
        { href: "/geraete", text: "Geräte" },
        ...(admin ? [{ href: "/plankosten", text: "Plankosten" }] : []),
      ],
    },
    ...(buero ? [{
      titel: "Einstellungen", klappbar: true,
      eintraege: [
        ...(admin ? [
          { href: "/einstellungen/benutzer", text: "Benutzer" },
          { href: "/einstellungen/postfaecher", text: "Postfächer" },
          { href: "/einstellungen/nummernkreise", text: "Nummernkreise" },
          { href: "/einstellungen/buchhaltung", text: "Buchhaltung" },
          { href: "/einstellungen/telefonagent", text: "Telefonagent" },
          { href: "/einstellungen/messenger", text: "Messenger" },
          { href: "/einstellungen/radar", text: "Ausschreibungs-Radar" },
        ] : []),
        { href: "/einstellungen/api", text: "API" },
      ],
    }] : []),
  ];
  const schnell = [
    { href: "/", text: "Start" },
    { href: "/zeiten", text: "Zeiten" },
    { href: "/projekte", text: "Projekte" },
    { href: "/einkauf/lieferscheine", text: "Lieferschein" },
  ];
  const fuss = (
    <>
      <Link href="/einstellungen/passwort" className="text-slate-500 hover:text-marke">Passwort ändern</Link>
      <form action={mandantWechseln}><button className="text-slate-500 hover:text-marke">Mandant wechseln</button></form>
      <form action={logoutAktion}><button className="text-slate-500 hover:text-red-600">Abmelden</button></form>
    </>
  );

  return (
    <div className="min-h-screen" style={markenStil(m)}>
      <Suspense fallback={<div className="h-14 border-b border-slate-200 bg-white lg:hidden" />}>
        <AppNavigation
          gruppen={gruppen} schnell={schnell} firmaName={b.mandant.name} benutzer={b.name} fuss={fuss}
          marke={m ? { logo: m.logo, breite: m.logoBreite, hoehe: m.logoHoehe } : null}
        />
      </Suspense>
      <div className="lg:pl-64">
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 lg:px-8 lg:pb-10">{children}</main>
      </div>
    </div>
  );
}

import Link from "next/link";

const SEITEN = [
  { href: "/rechnungen", text: "Alle Rechnungen" },
  { href: "/rechnungen/offene-posten", text: "Offene Posten" },
  { href: "/rechnungen/bank", text: "Kontoauszug" },
  { href: "/rechnungen/datev", text: "DATEV-Export" },
];

export function RechnungenNav({ aktiv }: { aktiv: string }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {SEITEN.map((s) => <Link key={s.href} href={s.href} className={aktiv === s.href ? "btn" : "btn-hell"}>{s.text}</Link>)}
    </div>
  );
}

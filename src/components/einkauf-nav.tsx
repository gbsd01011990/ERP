import Link from "next/link";

export function EinkaufNav({ aktiv, buero }: { aktiv: string; buero: boolean }) {
  const seiten = [
    ...(buero ? [{ href: "/einkauf", text: "Eingangsrechnungen" }] : []),
    { href: "/einkauf?ansicht=bestellungen", text: "Bestellungen" },
    ...(buero ? [{ href: "/einkauf/vorschlag", text: "Bestellvorschlag Lager" }] : []),
  ];
  return <div className="flex flex-wrap gap-2 text-sm">{seiten.map((s) => <Link key={s.href} href={s.href} className={aktiv === s.href ? "btn" : "btn-hell"}>{s.text}</Link>)}</div>;
}

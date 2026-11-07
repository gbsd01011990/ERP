import Link from "next/link";

/** Firmenumschalter als Reiter für Seiten mit genau einer Firma. */
export function FirmenTabs({ firmen, aktiv, pfad }: { firmen: { id: string; name: string }[]; aktiv: string; pfad: string }) {
  if (firmen.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {firmen.map((f) => (
        <Link key={f.id} href={`${pfad}?firma=${f.id}`} className={f.id === aktiv ? "btn" : "btn-hell"}>{f.name}</Link>
      ))}
    </div>
  );
}

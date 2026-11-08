import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MANDANTEN, MANDANT_COOKIE, mandantNachSlug, markenStil } from "@/lib/mandanten";

export const metadata: Metadata = { title: "Mandant wählen" };

type Props = { searchParams: Promise<{ auswahl?: string }> };

export default async function MandantAuswahl({ searchParams }: Props) {
  const zuletzt = (await cookies()).get(MANDANT_COOKIE)?.value;
  // Wer zuletzt bei einem Mandanten angemeldet war, landet direkt auf dessen Maske
  if (zuletzt && mandantNachSlug(zuletzt) && !(await searchParams).auswahl) redirect(`/login/${zuletzt}`);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="h1">Mandant wählen</h1>
      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {MANDANTEN.map((m) => (
          <Link
            key={m.slug}
            href={`/login/${m.slug}`}
            style={markenStil(m)}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 bg-white p-5 text-center shadow-sm transition hover:border-marke hover:shadow-md ${m.slug === zuletzt ? "border-marke" : "border-transparent"}`}
          >
            <Image src={m.logo} alt="" width={m.logoBreite} height={m.logoHoehe} className="h-16 w-auto object-contain" />
            <span className="font-semibold text-slate-800">{m.name}</span>
            <span className="text-xs text-slate-500">{m.zusatz}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

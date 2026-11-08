import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mandantNachSlug, markenStil, MANDANTEN } from "@/lib/mandanten";
import { LoginFormular } from "./login-formular";

type Props = { params: Promise<{ mandant: string }> };

export function generateStaticParams() {
  return MANDANTEN.map((m) => ({ mandant: m.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = mandantNachSlug((await params).mandant);
  return { title: m ? `Anmelden · ${m.name}` : "Anmelden" };
}

export default async function MandantLogin({ params }: Props) {
  const m = mandantNachSlug((await params).mandant);
  if (!m) notFound();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-marke-hell p-4" style={markenStil(m)}>
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-lg">
        <div className="h-1.5 bg-marke" />
        <div className="space-y-6 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <Image src={m.logo} alt={m.name} width={m.logoBreite} height={m.logoHoehe} priority className="h-20 w-auto object-contain" />
            <p className="text-xs uppercase tracking-wide text-slate-500">{m.zusatz}</p>
          </div>
          <LoginFormular slug={m.slug} name={m.name} />
        </div>
      </div>
      <Link href="/login?auswahl=1" className="mt-4 text-sm text-slate-500 hover:text-marke">Anderen Mandanten wählen</Link>
    </main>
  );
}

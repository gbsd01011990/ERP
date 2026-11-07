import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { KontaktFormular } from "../../kontakt-formular";

export default async function KontaktBearbeiten({ params }: { params: Promise<{ id: string }> }) {
  await benutzerPflicht(["ADMIN", "BUERO"]);
  const { id } = await params;
  const k = await db.kontakt.findUnique({ where: { id }, include: { adressen: true } });
  if (!k) notFound();
  return <KontaktFormular kontakt={k} />;
}

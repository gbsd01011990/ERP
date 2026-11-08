import { NextResponse } from "next/server";
import { aktuellerBenutzer } from "@/lib/auth";
import { db } from "@/lib/db";
import { berlinTag, berlinUhrzeit, berlinZuUtc, tagPlus, wochenbeginn, kalenderwoche, minutenZwischen } from "@/lib/zeit";
import { KATEGORIE_TEXT } from "@/lib/zeit-texte";

/** CSV (Semikolon, UTF-8 mit BOM, deutsche Dezimalzahlen) – öffnet direkt in Excel. */
export async function GET(req: Request) {
  const b = await aktuellerBenutzer();
  if (!b) return new NextResponse("Nicht angemeldet", { status: 401 });
  if (b.rolle === "KOLONNE") return new NextResponse("Keine Berechtigung", { status: 403 });
  const param = new URL(req.url).searchParams.get("woche") ?? berlinTag(new Date());
  const woche = wochenbeginn(/^\d{4}-\d{2}-\d{2}$/.test(param) ? param : berlinTag(new Date()));

  const eintraege = await db.zeiteintrag.findMany({
    where: { firmaId: b.mandant.id, beginn: { gte: berlinZuUtc(woche), lt: berlinZuUtc(tagPlus(woche, 7)) }, ende: { not: null } },
    include: { benutzer: true, projekt: true },
    orderBy: [{ benutzer: { name: "asc" } }, { beginn: "asc" }],
  });

  const feld = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const zeilen = [
    ["Mitarbeiter", "E-Mail", "Datum", "Beginn", "Ende", "Stunden", "Tätigkeit", "Arbeitszeit", "Projekt", "Projekttitel", "Notiz", "Freigegeben"],
    ...eintraege.map((e) => [
      e.benutzer.name, e.benutzer.email, berlinTag(e.beginn), berlinUhrzeit(e.beginn), berlinUhrzeit(e.ende!),
      (minutenZwischen(e.beginn, e.ende!) / 60).toFixed(2).replace(".", ","),
      KATEGORIE_TEXT[e.kategorie], e.kategorie === "PAUSE" ? "nein" : "ja",
      e.projekt?.nummer ?? "", e.projekt?.titel ?? "", e.notiz ?? "", e.freigegebenAm ? "ja" : "nein",
    ]),
  ];
  const csv = "﻿" + zeilen.map((z) => z.map((v) => feld(String(v))).join(";")).join("\r\n") + "\r\n";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Zeiten_${b.mandant.kuerzel}_KW${kalenderwoche(woche)}_${woche.slice(0, 4)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

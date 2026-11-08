import { z } from "zod";
import { Prisma, type Zeiteintrag } from "@prisma/client";
import { db } from "../db";
import type { AktuellerBenutzer } from "../auth";
import { minutenZwischen, stundenText } from "../zeit";
import { FachFehler } from "./fehler";

export const KATEGORIEN = ["UMSETZUNG", "FAHRZEIT", "VOR_ORT_TERMIN", "PROJEKTIERUNG", "BUEROARBEIT", "AUFGABE", "PAUSE", "SONSTIGE"] as const;
/** Für diese Tätigkeiten ist ein Projekt Pflicht, sonst fehlt die Nachkalkulation. */
const PROJEKT_PFLICHT = new Set(["UMSETZUNG", "VOR_ORT_TERMIN"]);
const MAX_MINUTEN = 14 * 60;
/** Einträge unter einer Minute gelten als Versehen und werden beim Stoppen verworfen. */
const KURZ_MS = 60_000;

const istBuero = (b: AktuellerBenutzer) => b.rolle === "ADMIN" || b.rolle === "BUERO";

/** Kolonne bucht nur für sich; Büro/Admin für jeden Mitarbeiter des Mandanten. */
async function mitarbeiterPruefen(b: AktuellerBenutzer, benutzerId: string) {
  if (benutzerId !== b.id && !istBuero(b)) throw new FachFehler("Du kannst nur deine eigenen Zeiten erfassen.", "KEIN_ZUGRIFF");
  const zugriff = await db.zugriff.findUnique({ where: { benutzerId_firmaId: { benutzerId, firmaId: b.mandant.id } } });
  if (!zugriff) throw new FachFehler("Mitarbeiter gehört nicht zu diesem Mandanten.", "KEIN_ZUGRIFF");
}

async function projektPruefen(b: AktuellerBenutzer, projektId: string | null | undefined, kategorie: string) {
  if (!projektId) {
    if (PROJEKT_PFLICHT.has(kategorie)) throw new FachFehler("Für diese Tätigkeit bitte ein Projekt wählen.");
    return null;
  }
  const p = await db.projekt.findUnique({ where: { id: projektId } });
  if (!p || p.firmaId !== b.mandant.id) throw new FachFehler("Projekt nicht gefunden.", "NICHT_GEFUNDEN");
  return p.id;
}

/** Überschneidung mit anderen Einträgen desselben Mitarbeiters (laufende zählen bis „unendlich“). */
async function ueberschneidungPruefen(tx: Prisma.TransactionClient, benutzerId: string, beginn: Date, ende: Date | null, ohneId?: string) {
  const konflikt = await tx.zeiteintrag.findFirst({
    where: {
      benutzerId,
      ...(ohneId ? { id: { not: ohneId } } : {}),
      beginn: ende ? { lt: ende } : undefined,
      OR: [{ ende: null }, { ende: { gt: beginn } }],
    },
    include: { projekt: true },
  });
  if (konflikt) {
    const bis = konflikt.ende ? ` bis ${konflikt.ende.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })}` : " (läuft noch)";
    throw new FachFehler(
      `Überschneidung mit einem anderen Eintrag ab ${konflikt.beginn.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}${bis}.`,
    );
  }
}

function dauerPruefen(beginn: Date, ende: Date) {
  const min = minutenZwischen(beginn, ende);
  if (min <= 0) throw new FachFehler("Das Ende muss nach dem Beginn liegen.");
  if (min > MAX_MINUTEN) throw new FachFehler(`Ein Eintrag darf höchstens 14 Stunden lang sein (hier ${stundenText(min)} h). Wurde das Ausstempeln vergessen?`);
}

const gesperrt = (e: Zeiteintrag) => e.freigegebenAm != null;

// ------------------------------------------------------------ Stempeluhr

export const StartEingabe = z.object({
  kategorie: z.enum(KATEGORIEN).default("UMSETZUNG"),
  projektId: z.string().nullish(),
  notiz: z.string().nullish(),
});

/** Startet die Stempeluhr. Läuft schon eine, wird sie zum selben Zeitpunkt beendet (Wechsel der Tätigkeit). */
export async function starten(b: AktuellerBenutzer, eingabe: z.input<typeof StartEingabe>, jetzt = new Date()) {
  const e = StartEingabe.parse(eingabe);
  const projektId = await projektPruefen(b, e.projektId, e.kategorie);
  return db.$transaction(
    async (tx) => {
      const laufend = await tx.zeiteintrag.findFirst({ where: { benutzerId: b.id, ende: null } });
      if (laufend) {
        if (jetzt.getTime() - laufend.beginn.getTime() < KURZ_MS) {
          await tx.zeiteintrag.delete({ where: { id: laufend.id } }); // versehentlich gestartet
        } else {
          dauerPruefen(laufend.beginn, jetzt);
          await tx.zeiteintrag.update({ where: { id: laufend.id }, data: { ende: jetzt } });
        }
      }
      await ueberschneidungPruefen(tx, b.id, jetzt, null);
      return tx.zeiteintrag.create({
        data: { firmaId: b.mandant.id, benutzerId: b.id, erfasstVonId: b.id, kategorie: e.kategorie, projektId, beginn: jetzt, notiz: e.notiz?.trim() || null },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** Stoppt die laufende Stempeluhr des angemeldeten Mitarbeiters. */
export async function stoppen(b: AktuellerBenutzer, jetzt = new Date()) {
  const laufend = await db.zeiteintrag.findFirst({ where: { benutzerId: b.id, ende: null } });
  if (!laufend) throw new FachFehler("Es läuft keine Stempeluhr.");
  if (jetzt.getTime() - laufend.beginn.getTime() < KURZ_MS) {
    await db.zeiteintrag.delete({ where: { id: laufend.id } });
    return { ...laufend, ende: jetzt, verworfen: true as const };
  }
  dauerPruefen(laufend.beginn, jetzt);
  return { ...(await db.zeiteintrag.update({ where: { id: laufend.id }, data: { ende: jetzt } })), verworfen: false as const };
}

export const laufenderEintrag = (benutzerId: string) =>
  db.zeiteintrag.findFirst({ where: { benutzerId, ende: null }, include: { projekt: true } });

// ------------------------------------------------------------ Erfassen und Ändern

export const EintragEingabe = z.object({
  benutzerId: z.string().min(1),
  kategorie: z.enum(KATEGORIEN),
  projektId: z.string().nullish(),
  beginn: z.date(),
  ende: z.date(),
  notiz: z.string().nullish(),
});

/** Legt einen abgeschlossenen Eintrag an (id = null) oder ändert ihn. */
export async function eintragSpeichern(b: AktuellerBenutzer, id: string | null, eingabe: z.input<typeof EintragEingabe>) {
  const e = EintragEingabe.parse(eingabe);
  await mitarbeiterPruefen(b, e.benutzerId);
  dauerPruefen(e.beginn, e.ende);
  if (e.ende > new Date(Date.now() + 5 * 60000)) throw new FachFehler("Zeiten in der Zukunft lassen sich nicht erfassen.");
  const projektId = await projektPruefen(b, e.projektId, e.kategorie);

  return db.$transaction(
    async (tx) => {
      if (id) {
        const alt = await tx.zeiteintrag.findUnique({ where: { id } });
        if (!alt || alt.firmaId !== b.mandant.id) throw new FachFehler("Eintrag nicht gefunden.", "NICHT_GEFUNDEN");
        await mitarbeiterPruefen(b, alt.benutzerId);
        if (gesperrt(alt) && b.rolle !== "ADMIN") throw new FachFehler("Der Eintrag ist freigegeben und gesperrt. Änderungen nur durch einen Admin.");
        if (alt.benutzerId !== e.benutzerId) throw new FachFehler("Der Mitarbeiter eines Eintrags lässt sich nicht ändern.");
      }
      await ueberschneidungPruefen(tx, e.benutzerId, e.beginn, e.ende, id ?? undefined);
      const daten = { kategorie: e.kategorie, projektId, beginn: e.beginn, ende: e.ende, notiz: e.notiz?.trim() || null };
      return id
        ? tx.zeiteintrag.update({ where: { id }, data: { ...daten, freigegebenAm: null, freigegebenVonId: null } })
        : tx.zeiteintrag.create({ data: { ...daten, firmaId: b.mandant.id, benutzerId: e.benutzerId, erfasstVonId: b.id } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function eintragLoeschen(b: AktuellerBenutzer, id: string) {
  const e = await db.zeiteintrag.findUnique({ where: { id } });
  if (!e || e.firmaId !== b.mandant.id) throw new FachFehler("Eintrag nicht gefunden.", "NICHT_GEFUNDEN");
  await mitarbeiterPruefen(b, e.benutzerId);
  if (gesperrt(e) && b.rolle !== "ADMIN") throw new FachFehler("Der Eintrag ist freigegeben und gesperrt.");
  await db.zeiteintrag.delete({ where: { id } });
  return e;
}

// ------------------------------------------------------------ Freigabe

/** Gibt alle abgeschlossenen Einträge eines Mitarbeiters im Zeitraum frei (Büro/Admin). */
export async function freigeben(b: AktuellerBenutzer, benutzerId: string, von: Date, bis: Date) {
  if (!istBuero(b)) throw new FachFehler("Freigaben macht das Büro.", "KEIN_ZUGRIFF");
  await mitarbeiterPruefen(b, benutzerId);
  const r = await db.zeiteintrag.updateMany({
    where: { firmaId: b.mandant.id, benutzerId, beginn: { gte: von, lt: bis }, ende: { not: null }, freigegebenAm: null },
    data: { freigegebenAm: new Date(), freigegebenVonId: b.id },
  });
  return r.count;
}

/** Hebt eine Freigabe wieder auf (nur Admin), z. B. für Korrekturen. */
export async function freigabeAufheben(b: AktuellerBenutzer, benutzerId: string, von: Date, bis: Date) {
  if (b.rolle !== "ADMIN") throw new FachFehler("Freigaben aufheben darf nur ein Admin.", "KEIN_ZUGRIFF");
  await mitarbeiterPruefen(b, benutzerId);
  const r = await db.zeiteintrag.updateMany({
    where: { firmaId: b.mandant.id, benutzerId, beginn: { gte: von, lt: bis }, freigegebenAm: { not: null } },
    data: { freigegebenAm: null, freigegebenVonId: null },
  });
  return r.count;
}

"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { benutzerPflicht, firmenIds } from "@/lib/auth";
import { naechsteNummer } from "@/lib/nummern";
import { nettoAktualisieren } from "@/lib/angebot";
import { parseZahl, aufmassSumme } from "@/lib/kalkulation";
import { angebotAnlegen as angebotAnlegenDienst, positionHinzufuegen as positionHinzufuegenDienst } from "@/lib/dienste/angebote";

const text = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

/** Lädt das Angebot mit Rechteprüfung. `entwurf`: nur im Status ENTWURF änderbar. */
async function angebotPruefen(id: string, entwurf = true) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const a = await db.angebot.findUniqueOrThrow({ where: { id } });
  if (!firmenIds(b).includes(a.firmaId)) throw new Error("Kein Zugriff.");
  if (entwurf && a.status !== "ENTWURF") throw new Error("Nur Entwürfe lassen sich bearbeiten. Lege eine neue Version an.");
  return { b, a };
}

const neuLaden = (id: string) => revalidatePath(`/angebote/${id}`);

/** Projektstatus vorwärts setzen (nie zurück) und im Logbuch vermerken. */
async function projektStatusVor(tx: Prisma.TransactionClient, projektId: string, statusName: string, benutzerId: string, notiz: string) {
  const p = await tx.projekt.findUniqueOrThrow({ where: { id: projektId }, include: { status: true } });
  const ziel = await tx.pipelineStatus.findUnique({ where: { firmaId_name: { firmaId: p.firmaId, name: statusName } } });
  const vor = ziel && !p.status.abgeschlossen && ziel.reihenfolge > p.status.reihenfolge;
  await tx.projekt.update({
    where: { id: projektId },
    data: {
      ...(vor ? { statusId: ziel.id } : {}),
      logbuch: {
        create: [
          { art: "SYSTEM", text: notiz, benutzerId },
          ...(vor ? [{ art: "STATUS" as const, text: `Status geändert: ${ziel.name}`, benutzerId }] : []),
        ],
      },
    },
  });
}

// ------------------------------------------------------------ Anlegen

export async function angebotAnlegen(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const a = await angebotAnlegenDienst(b, String(form.get("projektId")));
  redirect(`/angebote/${a.id}`);
}

// ------------------------------------------------------------ Kopf

export async function angebotKopfSpeichern(form: FormData) {
  const { a } = await angebotPruefen(String(form.get("id")));
  const gueltig = text(form.get("gueltigBis"));
  await db.angebot.update({
    where: { id: a.id },
    data: {
      betreff: text(form.get("betreff")) ?? a.betreff,
      anrede: text(form.get("anrede")),
      einleitung: text(form.get("einleitung")),
      vorbemerkung: text(form.get("vorbemerkung")),
      schlusstext: text(form.get("schlusstext")),
      gueltigBis: gueltig ? new Date(gueltig) : null,
      stundensatz: parseZahl(form.get("stundensatz"), Number(a.stundensatz)),
      materialAufschlag: parseZahl(form.get("materialAufschlag"), Number(a.materialAufschlag)),
      fremdAufschlag: parseZahl(form.get("fremdAufschlag"), Number(a.fremdAufschlag)),
    },
  });
  await nettoAktualisieren(a.id);
  neuLaden(a.id);
}

// ------------------------------------------------------------ Positionen

export async function positionHinzufuegen(form: FormData) {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const angebotId = String(form.get("angebotId"));
  await positionHinzufuegenDienst(b, angebotId, {
    art: z.enum(["GRUPPE", "POSITION", "TEXT"]).parse(form.get("art")),
    leistungId: text(form.get("leistungId")),
    kurztext: text(form.get("kurztext")),
    menge: parseZahl(form.get("menge"), 1),
  });
  neuLaden(angebotId);
}

export async function positionSpeichern(form: FormData) {
  const pos = await db.angebotsPosition.findUniqueOrThrow({ where: { id: String(form.get("id")) }, include: { aufmass: true } });
  await angebotPruefen(pos.angebotId);
  const ep = text(form.get("einzelpreis"));
  const menge = pos.aufmass.length ? aufmassSumme(pos.aufmass) : parseZahl(form.get("menge"), 0);
  // Kalkulation aus dem Leistungsstamm übernehmen (z. B. für Positionen aus einer GAEB-Ausschreibung): Texte und OZ bleiben
  const ausLeistung = text(form.get("kalkAusLeistung"));
  if (ausLeistung) {
    const angebot = await db.angebot.findUniqueOrThrow({ where: { id: pos.angebotId } });
    const l = await db.leistung.findUnique({ where: { id: ausLeistung } });
    if (!l || l.firmaId !== angebot.firmaId) throw new Error("Leistung nicht gefunden.");
    await db.angebotsPosition.update({
      where: { id: pos.id },
      data: { leistungId: l.id, minuten: l.minuten, materialEk: l.materialEk, geraete: l.geraete, fremdEk: l.fremdEk, preisFest: l.festpreis != null, einzelpreis: l.festpreis ?? 0, menge },
    });
    await nettoAktualisieren(pos.angebotId);
    neuLaden(pos.angebotId);
    return;
  }
  await db.angebotsPosition.update({
    where: { id: pos.id },
    data: {
      kurztext: text(form.get("kurztext")) ?? pos.kurztext,
      langtext: text(form.get("langtext")),
      ...(pos.art === "POSITION"
        ? {
            menge,
            einheit: text(form.get("einheit")) ?? pos.einheit,
            minuten: parseZahl(form.get("minuten")),
            materialEk: parseZahl(form.get("materialEk")),
            geraete: parseZahl(form.get("geraete")),
            fremdEk: parseZahl(form.get("fremdEk")),
            // Leeres Preisfeld = kalkulierter Preis, sonst fester Preis
            preisFest: ep != null,
            einzelpreis: ep != null ? parseZahl(ep) : 0,
            bedarf: form.get("bedarf") === "on",
          }
        : {}),
    },
  });
  await nettoAktualisieren(pos.angebotId);
  neuLaden(pos.angebotId);
}

export async function positionVerschieben(form: FormData) {
  const pos = await db.angebotsPosition.findUniqueOrThrow({ where: { id: String(form.get("id")) } });
  await angebotPruefen(pos.angebotId);
  const hoch = form.get("richtung") === "hoch";
  const nachbar = await db.angebotsPosition.findFirst({
    where: { angebotId: pos.angebotId, reihenfolge: hoch ? { lt: pos.reihenfolge } : { gt: pos.reihenfolge } },
    orderBy: { reihenfolge: hoch ? "desc" : "asc" },
  });
  if (!nachbar) return;
  await db.$transaction([
    db.angebotsPosition.update({ where: { id: pos.id }, data: { reihenfolge: nachbar.reihenfolge } }),
    db.angebotsPosition.update({ where: { id: nachbar.id }, data: { reihenfolge: pos.reihenfolge } }),
  ]);
  neuLaden(pos.angebotId);
}

export async function positionLoeschen(form: FormData) {
  const pos = await db.angebotsPosition.findUniqueOrThrow({ where: { id: String(form.get("id")) } });
  await angebotPruefen(pos.angebotId);
  await db.angebotsPosition.delete({ where: { id: pos.id } });
  await nettoAktualisieren(pos.angebotId);
  neuLaden(pos.angebotId);
}

// ------------------------------------------------------------ Status

export async function angebotVersendet(form: FormData) {
  const { a, b } = await angebotPruefen(String(form.get("id")));
  const anzahl = await db.angebotsPosition.count({ where: { angebotId: a.id, art: "POSITION" } });
  if (!anzahl) throw new Error("Das Angebot hat noch keine Positionen.");
  await db.$transaction(async (tx) => {
    await tx.angebot.update({ where: { id: a.id }, data: { status: "VERSENDET", datum: new Date() } });
    if (a.art === "ANGEBOT") await projektStatusVor(tx, a.projektId, "Angebot versendet", b.id, `Angebot ${a.nummer} als versendet markiert`);
  });
  neuLaden(a.id);
  revalidatePath(`/projekte/${a.projektId}`);
}

export async function angebotAbgelehnt(form: FormData) {
  const { a, b } = await angebotPruefen(String(form.get("id")), false);
  if (a.status !== "VERSENDET") throw new Error("Nur versendete Angebote können abgelehnt werden.");
  await db.$transaction([
    db.angebot.update({ where: { id: a.id }, data: { status: "ABGELEHNT" } }),
    db.logbuchEintrag.create({ data: { projektId: a.projektId, benutzerId: b.id, art: "SYSTEM", text: `Angebot ${a.nummer} abgelehnt` } }),
  ]);
  neuLaden(a.id);
}

/** Kopie mit allen Positionen anlegen – für neue Version und Auftragsbestätigung. */
async function kopieren(tx: Prisma.TransactionClient, quelleId: string, daten: Partial<Prisma.AngebotUncheckedCreateInput>) {
  // gaebQuelle ausdrücklich mitladen: Kopien (Version, AB) müssen weiter auf das LV des Auftraggebers antworten
  const q = await tx.angebot.findUniqueOrThrow({ where: { id: quelleId }, omit: { gaebQuelle: false }, include: { positionen: { include: { aufmass: true } } } });
  const { id: _i, createdAt: _c, updatedAt: _u, positionen, gaebInfo, ...rest } = q;
  return tx.angebot.create({
    data: {
      ...rest,
      gaebInfo: gaebInfo ?? Prisma.JsonNull,
      status: "ENTWURF",
      datum: new Date(),
      vorgaengerId: q.id,
      ...daten,
      positionen: {
        create: positionen.map(({ id: _p, angebotId: _a, aufmass, ...p }) => ({
          ...p,
          aufmass: { create: aufmass.map(({ id: _z, positionId: _pid, createdAt: _cz, ...z }) => z) },
        })),
      },
    },
  });
}

export async function angebotAngenommen(form: FormData) {
  const { a, b } = await angebotPruefen(String(form.get("id")), false);
  if (a.art !== "ANGEBOT" || a.status !== "VERSENDET") throw new Error("Nur versendete Angebote können angenommen werden.");
  const ab = await db.$transaction(async (tx) => {
    await tx.angebot.update({ where: { id: a.id }, data: { status: "ANGENOMMEN" } });
    const nummer = await naechsteNummer(tx, a.firmaId, "AUFTRAG");
    const neu = await kopieren(tx, a.id, {
      art: "AUFTRAGSBESTAETIGUNG", nummer, version: 1, gueltigBis: null, erstelltVonId: b.id,
      einleitung: `vielen Dank für Ihren Auftrag. Wir bestätigen Ihnen die Ausführung der folgenden Leistungen auf Grundlage unseres Angebots ${a.nummer}.`,
    });
    await projektStatusVor(tx, a.projektId, "Auftragsbestätigung", b.id, `Angebot ${a.nummer} angenommen, Auftragsbestätigung ${nummer} angelegt`);
    return neu;
  });
  redirect(`/angebote/${ab.id}`);
}

export async function neueVersion(form: FormData) {
  const { a, b } = await angebotPruefen(String(form.get("id")), false);
  if (a.status === "ENTWURF") throw new Error("Ein Entwurf lässt sich direkt bearbeiten.");
  const hoechste = await db.angebot.aggregate({ where: { firmaId: a.firmaId, nummer: a.nummer }, _max: { version: true } });
  const neu = await db.$transaction(async (tx) => {
    if (a.status === "VERSENDET") await tx.angebot.update({ where: { id: a.id }, data: { status: "ERSETZT" } });
    const v = await kopieren(tx, a.id, { version: (hoechste._max.version ?? 1) + 1, erstelltVonId: b.id });
    await tx.logbuchEintrag.create({ data: { projektId: a.projektId, benutzerId: b.id, art: "SYSTEM", text: `${a.nummer} Version ${v.version} angelegt` } });
    return v;
  });
  redirect(`/angebote/${neu.id}`);
}

export async function angebotLoeschen(form: FormData) {
  const { a } = await angebotPruefen(String(form.get("id")));
  await db.angebot.delete({ where: { id: a.id } });
  redirect(`/projekte/${a.projektId}`);
}

// ------------------------------------------------------------ Aufmaß

async function mengeAusAufmass(positionId: string) {
  const zeilen = await db.aufmassZeile.findMany({ where: { positionId } });
  const pos = await db.angebotsPosition.update({
    where: { id: positionId },
    data: zeilen.length ? { menge: aufmassSumme(zeilen) } : {},
  });
  await nettoAktualisieren(pos.angebotId);
  neuLaden(pos.angebotId);
}

export async function aufmassHinzufuegen(form: FormData) {
  const pos = await db.angebotsPosition.findUniqueOrThrow({ where: { id: String(form.get("positionId")) } });
  await angebotPruefen(pos.angebotId);
  const faktor = (k: string) => (text(form.get(k)) == null ? null : parseZahl(form.get(k)));
  const werte = { anzahl: faktor("anzahl"), laenge: faktor("laenge"), breite: faktor("breite"), hoehe: faktor("hoehe") };
  if (Object.values(werte).every((v) => v == null)) throw new Error("Mindestens einen Wert eintragen.");
  const letzte = await db.aufmassZeile.findFirst({ where: { positionId: pos.id }, orderBy: { reihenfolge: "desc" } });
  await db.aufmassZeile.create({
    data: { positionId: pos.id, reihenfolge: (letzte?.reihenfolge ?? 0) + 1, text: text(form.get("text")), abzug: form.get("abzug") === "on", ...werte },
  });
  await mengeAusAufmass(pos.id);
}

export async function aufmassLoeschen(form: FormData) {
  const z = await db.aufmassZeile.findUniqueOrThrow({ where: { id: String(form.get("id")) }, include: { position: true } });
  await angebotPruefen(z.position.angebotId);
  await db.aufmassZeile.delete({ where: { id: z.id } });
  await mengeAusAufmass(z.positionId);
}

import { GraphQLScalarType, Kind } from "graphql";
import type { Prisma, Projekt, Kontakt, Leistung, Angebot, AngebotsPosition, AufmassZeile, Firma } from "@prisma/client";
import { db } from "@/lib/db";
import { firmenIds, type AktuellerBenutzer } from "@/lib/auth";
import { kontaktName } from "@/lib/format";
import { n, nummerieren, wirksamerEp, runden, summen, einzelpreisAnteile, aufmassErgebnis } from "@/lib/kalkulation";
import { FachFehler } from "@/lib/dienste/fehler";
import { kontaktSpeichern, type KontaktEingabe } from "@/lib/dienste/kontakte";
import { projektAnlegen, projektStatusSetzen, logbuchEintragen, type ProjektEingabe } from "@/lib/dienste/projekte";
import { leistungSpeichern, type LeistungEingabe } from "@/lib/dienste/leistungen";
import { angebotAnlegen, positionHinzufuegen, type PositionEingabe } from "@/lib/dienste/angebote";

export type Kontext = { benutzer: AktuellerBenutzer; nurLesen: boolean };

const MAX = 200;
const seite = (first?: number | null, offset?: number | null) => ({
  take: Math.min(Math.max(first ?? 50, 0), MAX),
  skip: Math.max(offset ?? 0, 0),
});
const ci = (s: string) => ({ contains: s, mode: "insensitive" as const });

/** Firmenfilter: angefragte Firma muss erlaubt sein, sonst alle erlaubten. */
function firmen(ctx: Kontext, firmaId?: string | null) {
  const erlaubt = firmenIds(ctx.benutzer);
  if (firmaId && !erlaubt.includes(firmaId)) throw new FachFehler("Kein Zugriff auf diese Firma.", "KEIN_ZUGRIFF");
  return firmaId ? [firmaId] : erlaubt;
}

function schreiben(ctx: Kontext) {
  if (ctx.nurLesen) throw new FachFehler("Dieser API-Schlüssel darf nur lesen.", "KEIN_ZUGRIFF");
}

const zahl = (v: unknown) => (v == null ? null : n(v as number));

// Positionen eines Angebots einmal nummerieren und je Anfrage zwischenspeichern
type PosMitAufmass = AngebotsPosition & { aufmass: AufmassZeile[] };
const angebotDetail = async (id: string) =>
  db.angebot.findUniqueOrThrow({
    where: { id },
    include: { positionen: { orderBy: { reihenfolge: "asc" }, include: { aufmass: { orderBy: { reihenfolge: "asc" } } } } },
  });

const DateTime = new GraphQLScalarType({
  name: "DateTime",
  serialize: (v) => (v instanceof Date ? v.toISOString() : String(v)),
  parseValue: (v) => new Date(String(v)),
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? new Date(ast.value) : null),
});

export const resolvers = {
  DateTime,

  Query: {
    ich: (_: unknown, __: unknown, ctx: Kontext) => ctx.benutzer,
    firmen: (_: unknown, __: unknown, ctx: Kontext) =>
      db.firma.findMany({ where: { id: { in: firmenIds(ctx.benutzer) } }, orderBy: { name: "asc" } }),

    kontakte: async (_: unknown, a: { suche?: string; typ?: Kontakt["typ"]; first?: number; offset?: number }) => {
      const where: Prisma.KontaktWhereInput = {
        geloescht: false,
        ...(a.typ ? { typ: a.typ } : {}),
        ...(a.suche
          ? { OR: [{ nachname: ci(a.suche) }, { vorname: ci(a.suche) }, { firmenname: ci(a.suche) }, { email: ci(a.suche) }, { nummer: ci(a.suche) }, { adressen: { some: { ort: ci(a.suche) } } }] }
          : {}),
      };
      const [gesamt, eintraege] = await Promise.all([
        db.kontakt.count({ where }),
        db.kontakt.findMany({ where, orderBy: [{ nachname: "asc" }, { firmenname: "asc" }], ...seite(a.first, a.offset) }),
      ]);
      return { gesamt, eintraege };
    },
    kontakt: (_: unknown, a: { id: string }) => db.kontakt.findFirst({ where: { id: a.id, geloescht: false } }),

    projekte: async (
      _: unknown,
      a: { firmaId?: string; suche?: string; statusName?: string; kontaktId?: string; nurOffen?: boolean; first?: number; offset?: number },
      ctx: Kontext,
    ) => {
      const where: Prisma.ProjektWhereInput = {
        firmaId: { in: firmen(ctx, a.firmaId) },
        ...(a.kontaktId ? { kontaktId: a.kontaktId } : {}),
        ...(a.statusName ? { status: { name: a.statusName } } : a.nurOffen ? { status: { abgeschlossen: false } } : {}),
        ...(a.suche
          ? { OR: [{ nummer: ci(a.suche) }, { titel: ci(a.suche) }, { baustelleOrt: ci(a.suche) }, { kontakt: { OR: [{ nachname: ci(a.suche) }, { firmenname: ci(a.suche) }] } }] }
          : {}),
      };
      const [gesamt, eintraege] = await Promise.all([
        db.projekt.count({ where }),
        db.projekt.findMany({ where, orderBy: { updatedAt: "desc" }, ...seite(a.first, a.offset) }),
      ]);
      return { gesamt, eintraege };
    },
    projekt: async (_: unknown, a: { id?: string; firmaId?: string; nummer?: string }, ctx: Kontext) => {
      const p = a.id
        ? await db.projekt.findUnique({ where: { id: a.id } })
        : a.firmaId && a.nummer
          ? await db.projekt.findUnique({ where: { firmaId_nummer: { firmaId: a.firmaId, nummer: a.nummer } } })
          : null;
      if (!a.id && !(a.firmaId && a.nummer)) throw new FachFehler("id oder firmaId + nummer angeben.");
      return p && firmenIds(ctx.benutzer).includes(p.firmaId) ? p : null;
    },

    leistungen: async (_: unknown, a: { firmaId?: string; suche?: string; nurAktiv?: boolean; first?: number; offset?: number }, ctx: Kontext) => {
      const where: Prisma.LeistungWhereInput = {
        firmaId: { in: firmen(ctx, a.firmaId) },
        ...(a.nurAktiv ? { aktiv: true } : {}),
        ...(a.suche ? { OR: [{ kurztext: ci(a.suche) }, { nummer: ci(a.suche) }, { kategorie: ci(a.suche) }] } : {}),
      };
      const [gesamt, eintraege] = await Promise.all([
        db.leistung.count({ where }),
        db.leistung.findMany({ where, orderBy: [{ firmaId: "asc" }, { nummer: "asc" }], ...seite(a.first, a.offset) }),
      ]);
      return { gesamt, eintraege };
    },

    angebote: async (
      _: unknown,
      a: { firmaId?: string; projektId?: string; status?: Angebot["status"]; art?: Angebot["art"]; first?: number; offset?: number },
      ctx: Kontext,
    ) => {
      const where: Prisma.AngebotWhereInput = {
        firmaId: { in: firmen(ctx, a.firmaId) },
        ...(a.projektId ? { projektId: a.projektId } : {}),
        ...(a.status ? { status: a.status } : {}),
        ...(a.art ? { art: a.art } : {}),
      };
      const [gesamt, eintraege] = await Promise.all([
        db.angebot.count({ where }),
        db.angebot.findMany({ where, orderBy: { updatedAt: "desc" }, ...seite(a.first, a.offset) }),
      ]);
      return { gesamt, eintraege };
    },
    angebot: async (_: unknown, a: { id: string }, ctx: Kontext) => {
      const x = await db.angebot.findUnique({ where: { id: a.id } });
      return x && firmenIds(ctx.benutzer).includes(x.firmaId) ? x : null;
    },
  },

  Mutation: {
    kontaktAnlegen: (_: unknown, a: { eingabe: KontaktEingabe }, ctx: Kontext) => (schreiben(ctx), kontaktSpeichern(ctx.benutzer, null, a.eingabe)),
    kontaktAendern: (_: unknown, a: { id: string; eingabe: KontaktEingabe }, ctx: Kontext) => (schreiben(ctx), kontaktSpeichern(ctx.benutzer, a.id, a.eingabe)),
    projektAnlegen: (_: unknown, a: { eingabe: ProjektEingabe }, ctx: Kontext) => (schreiben(ctx), projektAnlegen(ctx.benutzer, a.eingabe)),
    projektStatusSetzen: (_: unknown, a: { projektId: string; statusId: string }, ctx: Kontext) =>
      (schreiben(ctx), projektStatusSetzen(ctx.benutzer, a.projektId, a.statusId)),
    logbuchEintragen: (_: unknown, a: { projektId: string; text: string; art: "NOTIZ" | "ANRUF" | "EMAIL" | "TERMIN" }, ctx: Kontext) =>
      (schreiben(ctx), logbuchEintragen(ctx.benutzer, a.projektId, a.art, a.text)),
    leistungSpeichern: (_: unknown, a: { id?: string; eingabe: LeistungEingabe }, ctx: Kontext) =>
      (schreiben(ctx), leistungSpeichern(ctx.benutzer, a.id ?? null, a.eingabe)),
    angebotAnlegen: (_: unknown, a: { projektId: string }, ctx: Kontext) => (schreiben(ctx), angebotAnlegen(ctx.benutzer, a.projektId)),
    angebotPositionHinzufuegen: async (_: unknown, a: { angebotId: string; eingabe: PositionEingabe }, ctx: Kontext) => {
      schreiben(ctx);
      await positionHinzufuegen(ctx.benutzer, a.angebotId, a.eingabe);
      return db.angebot.findUniqueOrThrow({ where: { id: a.angebotId } });
    },
  },

  Benutzer: {
    firmen: (b: AktuellerBenutzer) => b.zugriffe.map((z) => z.firma),
  },

  Firma: {
    stundensatz: (f: Firma) => n(f.stundensatz),
    materialAufschlag: (f: Firma) => n(f.materialAufschlag),
    fremdAufschlag: (f: Firma) => n(f.fremdAufschlag),
    mwstSatz: (f: Firma) => n(f.mwstSatz),
    pipeline: (f: Firma) => db.pipelineStatus.findMany({ where: { firmaId: f.id }, orderBy: { reihenfolge: "asc" } }),
    projektTypen: (f: Firma) => db.projektTyp.findMany({ where: { firmaId: f.id }, orderBy: { name: "asc" } }),
  },

  Kontakt: {
    anzeigename: (k: Kontakt) => kontaktName(k),
    adressen: (k: Kontakt) => db.adresse.findMany({ where: { kontaktId: k.id } }),
    ansprechpartner: (k: Kontakt) => db.ansprechpartner.findMany({ where: { kontaktId: k.id } }),
    projekte: (k: Kontakt, _: unknown, ctx: Kontext) =>
      db.projekt.findMany({ where: { kontaktId: k.id, firmaId: { in: firmenIds(ctx.benutzer) } }, orderBy: { createdAt: "desc" } }),
    erstelltAm: (k: Kontakt) => k.createdAt,
    geaendertAm: (k: Kontakt) => k.updatedAt,
  },

  Projekt: {
    volumen: (p: Projekt) => zahl(p.volumen),
    firma: (p: Projekt) => db.firma.findUniqueOrThrow({ where: { id: p.firmaId } }),
    status: (p: Projekt) => db.pipelineStatus.findUniqueOrThrow({ where: { id: p.statusId } }),
    typ: (p: Projekt) => (p.typId ? db.projektTyp.findUnique({ where: { id: p.typId } }) : null),
    kontakt: (p: Projekt) => db.kontakt.findUniqueOrThrow({ where: { id: p.kontaktId } }),
    verantwortlich: (p: Projekt) =>
      p.verantwortlichId ? db.benutzer.findUnique({ where: { id: p.verantwortlichId }, include: { zugriffe: { include: { firma: true } } } }) : null,
    logbuch: async (p: Projekt, a: { first?: number }) =>
      (await db.logbuchEintrag.findMany({
        where: { projektId: p.id }, orderBy: { createdAt: "desc" }, take: Math.min(a.first ?? 50, MAX), include: { benutzer: { select: { name: true } } },
      })).map((l) => ({ ...l, benutzer: l.benutzer?.name ?? null, erstelltAm: l.createdAt })),
    angebote: (p: Projekt) => db.angebot.findMany({ where: { projektId: p.id }, orderBy: { createdAt: "asc" } }),
    erstelltAm: (p: Projekt) => p.createdAt,
    geaendertAm: (p: Projekt) => p.updatedAt,
  },

  LogbuchEintrag: {
    erstelltAm: (l: { createdAt: Date }) => l.createdAt,
    benutzer: (l: { benutzer: unknown }) => (typeof l.benutzer === "string" ? l.benutzer : null),
  },

  Leistung: {
    firma: (l: Leistung) => db.firma.findUniqueOrThrow({ where: { id: l.firmaId } }),
    minuten: (l: Leistung) => n(l.minuten),
    materialEk: (l: Leistung) => n(l.materialEk),
    geraete: (l: Leistung) => n(l.geraete),
    fremdEk: (l: Leistung) => n(l.fremdEk),
    festpreis: (l: Leistung) => zahl(l.festpreis),
    einzelpreis: async (l: Leistung) => {
      if (l.festpreis != null) return n(l.festpreis);
      const f = await db.firma.findUniqueOrThrow({ where: { id: l.firmaId } });
      return einzelpreisAnteile(l, f).summe;
    },
  },

  Angebot: {
    belegnummer: (a: Angebot) => (a.version > 1 ? `${a.nummer}-${a.version}` : a.nummer),
    firma: (a: Angebot) => db.firma.findUniqueOrThrow({ where: { id: a.firmaId } }),
    projekt: (a: Angebot) => db.projekt.findUniqueOrThrow({ where: { id: a.projektId } }),
    positionen: async (a: Angebot) => {
      const d = await angebotDetail(a.id);
      return nummerieren(d.positionen).map((p) => ({ ...p, _angebot: d }));
    },
    summen: async (a: Angebot) => {
      const d = await angebotDetail(a.id);
      return summen(d.positionen, { stundensatz: d.stundensatz, materialAufschlag: d.materialAufschlag, fremdAufschlag: d.fremdAufschlag, mwstSatz: d.mwstSatz });
    },
    pdfPfad: (a: Angebot) => `/angebote/${a.id}/pdf`,
    erstelltAm: (a: Angebot) => a.createdAt,
    geaendertAm: (a: Angebot) => a.updatedAt,
  },

  AngebotsPosition: {
    menge: (p: PosMitAufmass) => n(p.menge),
    minuten: (p: PosMitAufmass) => n(p.minuten),
    materialEk: (p: PosMitAufmass) => n(p.materialEk),
    geraete: (p: PosMitAufmass) => n(p.geraete),
    fremdEk: (p: PosMitAufmass) => n(p.fremdEk),
    einzelpreis: (p: PosMitAufmass & { _angebot: Angebot }) => (p.art === "POSITION" ? wirksamerEp(p, p._angebot) : 0),
    gesamt: (p: PosMitAufmass & { _angebot: Angebot }) =>
      p.art === "POSITION" && !p.bedarf ? runden(wirksamerEp(p, p._angebot) * n(p.menge)) : 0,
  },

  AufmassZeile: {
    anzahl: (z: AufmassZeile) => zahl(z.anzahl),
    laenge: (z: AufmassZeile) => zahl(z.laenge),
    breite: (z: AufmassZeile) => zahl(z.breite),
    hoehe: (z: AufmassZeile) => zahl(z.hoehe),
    ergebnis: (z: AufmassZeile) => aufmassErgebnis(z),
  },
};

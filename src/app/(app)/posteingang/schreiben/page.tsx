import Link from "next/link";
import { db } from "@/lib/db";
import { benutzerPflicht } from "@/lib/auth";
import { datumZeit, kontaktName } from "@/lib/format";
import { meinePostfaecher, emailLaden } from "@/lib/dienste/mail";
import { zitat } from "@/lib/mailtext";
import { AktionsFormular } from "@/components/aktions-formular";
import { sendenAktion } from "../actions";

type Props = { searchParams: Promise<{ antwort?: string; kontakt?: string; projekt?: string; angebot?: string; an?: string; bestellung?: string }> };

export default async function Schreiben({ searchParams }: Props) {
  const b = await benutzerPflicht();
  const sp = await searchParams;
  const postfaecher = await meinePostfaecher(b);
  if (postfaecher.length === 0) {
    return <p className="karte text-sm">Dir ist kein Postfach zugewiesen. <Link href="/posteingang" className="text-marke">Zurück</Link></p>;
  }

  const original = sp.antwort ? await emailLaden(b, sp.antwort).catch(() => null) : null;
  const angebot = sp.angebot ? await db.angebot.findFirst({ where: { id: sp.angebot, firmaId: b.mandant.id }, include: { projekt: { include: { kontakt: true } } } }) : null;
  const bestellung = sp.bestellung ? await db.bestellung.findFirst({ where: { id: sp.bestellung, firmaId: b.mandant.id, nummer: { not: null } }, include: { lieferant: true, projekt: { include: { kontakt: true } } } }) : null;
  const projekt = angebot?.projekt ?? bestellung?.projekt ?? (sp.projekt ? await db.projekt.findFirst({ where: { id: sp.projekt, firmaId: b.mandant.id }, include: { kontakt: true } }) : null);
  const kontakt = bestellung?.lieferant ?? projekt?.kontakt ?? (sp.kontakt ? await db.kontakt.findUnique({ where: { id: sp.kontakt } }) : null);

  // Vorbelegung: Antwort an Absender, sonst Kontakt-E-Mail
  const an = original ? (original.richtung === "EINGANG" ? original.vonAdresse : original.an.join(", ")) : sp.an ?? kontakt?.email ?? "";
  const nr = angebot ? (angebot.version > 1 ? `${angebot.nummer}-${angebot.version}` : angebot.nummer) : "";
  const betreff = original
    ? `AW: ${original.betreff.replace(/^((AW|RE|WG|FW):\s*)+/i, "")}`
    : angebot ? `${angebot.art === "ANGEBOT" ? "Angebot" : "Auftragsbestätigung"} ${nr} – ${angebot.betreff}`
    : bestellung ? `Bestellung ${bestellung.nummer} – ${b.mandant.name}` : projekt ? `${projekt.titel}` : "";
  const anrede = angebot?.anrede ?? (kontakt ? "Guten Tag," : "");
  const textVorlage = original
    ? `\n\nMit freundlichen Grüßen\n${b.name}\n${b.mandant.name}` + (original.postfachId !== postfaecher[0]?.id ? zitat(original.text ?? "", original.vonName ?? original.vonAdresse, datumZeit(original.empfangenAm)) : "")
    : bestellung
      ? `Guten Tag,\n\nanbei unsere Bestellung ${bestellung.nummer}. Bitte bestätigen Sie Liefertermin und Preise und geben Sie unsere Bestellnummer auf Lieferschein und Rechnung an.\n\nMit freundlichen Grüßen\n${b.name}\n${b.mandant.name}`
    : angebot
      ? `${anrede}\n\nanbei erhalten Sie unser ${angebot.art === "ANGEBOT" ? "Angebot" : "Auftragsbestätigung"} ${nr}. Für Rückfragen stehen wir Ihnen gern zur Verfügung.\n\nMit freundlichen Grüßen\n${b.name}\n${b.mandant.name}`
      : `${anrede}\n\n\n\nMit freundlichen Grüßen\n${b.name}\n${b.mandant.name}`;
  // Antwort möglichst aus dem Postfach, in dem die Mail ankam
  const vorschlag = original && postfaecher.some((p) => p.id === original.postfachId) ? original.postfachId : postfaecher[0].id;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="h1">{original ? "Antworten" : "Neue E-Mail"}</h1>
      {(projekt || kontakt) && (
        <p className="text-sm text-slate-600">
          Wird abgelegt bei {projekt ? <Link href={`/projekte/${projekt.id}`} className="text-marke">{projekt.nummer} {projekt.titel}</Link> : <Link href={`/kontakte/${kontakt!.id}`} className="text-marke">{kontaktName(kontakt!)}</Link>}
        </p>
      )}
      <AktionsFormular aktion={sendenAktion} knopf="Senden" encType="multipart/form-data" className="karte grid gap-3">
        {original && <input type="hidden" name="antwortAufId" value={original.id} />}
        {projekt && <input type="hidden" name="projektId" value={projekt.id} />}
        {kontakt && <input type="hidden" name="kontaktId" value={kontakt.id} />}
        {angebot && <input type="hidden" name="angebotId" value={angebot.id} />}
        {bestellung && <input type="hidden" name="bestellungId" value={bestellung.id} />}
        <div>
          <label className="label" htmlFor="postfachId">Von</label>
          <select id="postfachId" name="postfachId" defaultValue={vorschlag} className="eingabe">
            {postfaecher.map((p) => <option key={p.id} value={p.id}>{p.name ? `${p.name} <${p.adresse}>` : p.adresse}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="an">An</label><input id="an" name="an" required defaultValue={an} className="eingabe" /></div>
        <div><label className="label" htmlFor="cc">Cc</label><input id="cc" name="cc" className="eingabe" /></div>
        <div><label className="label" htmlFor="betreff">Betreff</label><input id="betreff" name="betreff" required defaultValue={betreff} className="eingabe" /></div>
        <div><label className="label" htmlFor="text">Text</label><textarea id="text" name="text" required rows={14} defaultValue={textVorlage} className="eingabe font-sans" /></div>
        {angebot && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="angebotAnhaengen" defaultChecked /> {angebot.art === "ANGEBOT" ? "Angebot" : "Auftragsbestätigung"} {nr} als PDF anhängen{angebot.status === "ENTWURF" ? " und als versendet markieren" : ""}</label>
        )}
        {bestellung && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bestellungAnhaengen" defaultChecked /> Bestellung {bestellung.nummer} als PDF anhängen</label>}
        <div><label className="label" htmlFor="dateien">Weitere Anhänge</label><input id="dateien" name="dateien" type="file" multiple className="text-sm" /></div>
        {original && <p className="text-xs text-slate-500">Der bisherige Verlauf wird von Microsoft automatisch unter die Antwort gesetzt.</p>}
      </AktionsFormular>
    </div>
  );
}

"use client";
import { useState } from "react";
import { AktionsFormular } from "@/components/aktions-formular";
import { rechnungAnlegenAktion } from "@/app/(app)/rechnungen/actions";

type Angebot = { id: string; text: string };

/** Neue Rechnung zum Projekt: Art, Auftragsgrundlage und bei Abschlägen die Methode. */
export function RechnungNeu({ projektId, angebote }: { projektId: string; angebote: Angebot[] }) {
  const [art, setArt] = useState("RECHNUNG");
  const [modus, setModus] = useState("AUFMASS");
  return (
    <AktionsFormular aktion={rechnungAnlegenAktion} knopf="Rechnung anlegen" knopfKlasse="btn-hell py-1" className="grid gap-2">
      <input type="hidden" name="projektId" value={projektId} />
      <select name="art" value={art} onChange={(e) => setArt(e.target.value)} className="eingabe" aria-label="Rechnungsart">
        <option value="RECHNUNG">Rechnung</option>
        <option value="ABSCHLAG">Abschlagsrechnung</option>
        <option value="TEILSCHLUSS">Teilschlussrechnung</option>
        <option value="SCHLUSS">Schlussrechnung</option>
      </select>
      <select name="angebotId" defaultValue={angebote[angebote.length - 1]?.id ?? ""} className="eingabe" aria-label="Grundlage">
        <option value="">ohne Angebot (freie Positionen)</option>
        {angebote.map((a) => <option key={a.id} value={a.id}>{a.text}</option>)}
      </select>
      {art === "ABSCHLAG" && (
        <div className="flex flex-wrap gap-2">
          <select name="modus" value={modus} onChange={(e) => setModus(e.target.value)} className="eingabe w-auto" aria-label="Abschlagsmethode">
            <option value="AUFMASS">nach Leistungsstand (Aufmaß, kumuliert)</option>
            <option value="PLAN">nach Zahlungsplan (Prozent)</option>
          </select>
          {modus === "PLAN" && <input name="planProzent" placeholder="Prozent, z. B. 30" required className="eingabe w-40" aria-label="Prozent" />}
        </div>
      )}
    </AktionsFormular>
  );
}

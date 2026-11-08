import { berlinTag, tagPlus } from "@/lib/zeit";
import { AktionsFormular } from "./aktions-formular";
import { aufgabeAktion } from "@/app/(app)/posteingang/actions";

/** Kurzformular für eine neue Aufgabe, optional an Projekt oder Kontakt gebunden. */
export function AufgabeFormular({ mitarbeiter, ichId, projektId, kontaktId }: { mitarbeiter: { id: string; name: string }[]; ichId: string; projektId?: string; kontaktId?: string }) {
  return (
    <AktionsFormular aktion={aufgabeAktion} knopf="+ Aufgabe" knopfKlasse="btn-hell" zuruecksetzen className="grid gap-2 sm:grid-cols-[1fr_9.5rem_10rem]">
      {projektId && <input type="hidden" name="projektId" value={projektId} />}
      {kontaktId && <input type="hidden" name="kontaktId" value={kontaktId} />}
      <input name="titel" required placeholder="z. B. Kunden zurückrufen" className="eingabe" aria-label="Aufgabe" />
      <input type="date" name="faelligTag" defaultValue={tagPlus(berlinTag(new Date()), 1)} className="eingabe" aria-label="Fällig am" />
      <select name="zustaendigId" defaultValue={ichId} className="eingabe" aria-label="Zuständig">
        {mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </AktionsFormular>
  );
}

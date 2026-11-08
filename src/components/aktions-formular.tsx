"use client";
import { useFormularAktion } from "@/components/formular-aktion";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;

/**
 * Formular mit Server-Aktion und Rückmeldung (Fehler rot, Erfolg grün).
 * zuruecksetzen: Felder nach Erfolg leeren (neues Formular).
 */
export function AktionsFormular({
  aktion, children, knopf, className = "", knopfKlasse = "btn", zuruecksetzen = false, encType,
}: {
  aktion: (s: Ergebnis, f: FormData) => Promise<Ergebnis>;
  children?: React.ReactNode;
  knopf: string;
  className?: string;
  knopfKlasse?: string;
  zuruecksetzen?: boolean;
  encType?: "multipart/form-data";
}) {
  const { state, onSubmit, laeuft } = useFormularAktion(aktion);
  return (
    <form onSubmit={onSubmit} key={zuruecksetzen && state?.ok ? state.zeit : undefined} className={className} encType={encType}>
      {children}
      <div className="flex flex-wrap items-center gap-3 [grid-column:1/-1]">
        <button className={knopfKlasse} disabled={laeuft}>{laeuft ? "Bitte warten …" : knopf}</button>
        {state?.fehler && <span className="text-sm text-red-600" role="alert">{state.fehler}</span>}
        {state?.ok && <span className="text-sm text-emerald-700" role="status">{state.ok}</span>}
      </div>
    </form>
  );
}

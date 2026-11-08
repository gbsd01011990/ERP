"use client";
import { useFormularAktion } from "@/components/formular-aktion";

type Ergebnis = { fehler?: string; ok?: string; zeit: number } | null;

/** Wie AktionsFormular, zeigt die Rückmeldung aber vorformatiert (z. B. JSON der Testkonsole). */
export function AusgabeFormular({ aktion, children, knopf, className = "" }: {
  aktion: (s: Ergebnis, f: FormData) => Promise<Ergebnis>; children?: React.ReactNode; knopf: string; className?: string;
}) {
  const { state, onSubmit, laeuft } = useFormularAktion(aktion);
  return (
    <form onSubmit={onSubmit} className={className}>
      {children}
      <div className="[grid-column:1/-1] space-y-2">
        <button className="btn-hell" disabled={laeuft}>{laeuft ? "Bitte warten …" : knopf}</button>
        {state?.fehler && <pre role="alert" className="whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-700">{state.fehler}</pre>}
        {state?.ok && <pre role="status" className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-800">{state.ok}</pre>}
      </div>
    </form>
  );
}

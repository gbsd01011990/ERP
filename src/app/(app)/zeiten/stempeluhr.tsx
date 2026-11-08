"use client";
import { useActionState, useEffect, useState } from "react";
import { startenAktion, stoppenAktion } from "./actions";
import { KATEGORIE_TEXT } from "@/lib/zeit-texte";

type Laufend = { beginn: string; kategorie: keyof typeof KATEGORIE_TEXT; projekt: string | null } | null;
type Opt = { id: string; text: string };

function Laufzeit({ seit }: { seit: string }) {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setJetzt(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((jetzt - new Date(seit).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sek = s % 60;
  return <span className="font-mono text-4xl font-semibold tabular-nums">{h}:{String(m).padStart(2, "0")}:{String(sek).padStart(2, "0")}</span>;
}

export function Stempeluhr({ laufend, projekte, seitText }: { laufend: Laufend; projekte: Opt[]; seitText: string }) {
  const [startState, start, startet] = useActionState(startenAktion, null);
  const [stopState, stop, stoppt] = useActionState(stoppenAktion, null);
  const [kategorie, setKategorie] = useState<string>("UMSETZUNG");
  const meldung = [startState, stopState].filter(Boolean).sort((a, b) => b!.zeit - a!.zeit)[0];

  return (
    <section className="karte space-y-4">
      {laufend ? (
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-sm text-slate-500">{KATEGORIE_TEXT[laufend.kategorie]}{laufend.projekt ? ` · ${laufend.projekt}` : ""} · seit {seitText}</div>
            <Laufzeit seit={laufend.beginn} />
          </div>
          <form action={stop} className="ml-auto">
            <button className="rounded-lg bg-red-600 px-6 py-4 text-lg font-semibold text-white hover:bg-red-700 disabled:opacity-50" disabled={stoppt}>Ausstempeln</button>
          </form>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Nicht eingestempelt.</p>
      )}

      <form action={start} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]" key={startState?.zeit}>
        <div>
          <label className="label" htmlFor="kategorie">Tätigkeit</label>
          <select id="kategorie" name="kategorie" value={kategorie} onChange={(e) => setKategorie(e.target.value)} className="eingabe py-3">
            {Object.entries(KATEGORIE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="projektId">Projekt</label>
          <select id="projektId" name="projektId" className="eingabe py-3" disabled={kategorie === "PAUSE"}>
            <option value="">{kategorie === "UMSETZUNG" || kategorie === "VOR_ORT_TERMIN" ? "Bitte wählen …" : "– ohne Projekt –"}</option>
            {projekte.map((p) => <option key={p.id} value={p.id}>{p.text}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn w-full justify-center px-6 py-3 text-base" disabled={startet}>{laufend ? "Wechseln" : "Einstempeln"}</button>
        </div>
      </form>
      {meldung?.fehler && <p className="text-sm text-red-600" role="alert">{meldung.fehler}</p>}
      {meldung?.ok && <p className="text-sm text-emerald-700" role="status">{meldung.ok}</p>}
    </section>
  );
}

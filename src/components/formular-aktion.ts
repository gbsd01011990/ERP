"use client";
import { startTransition, useActionState, type FormEvent } from "react";

/**
 * Wie useActionState, aber ohne das automatische Leeren des Formulars, das React bei
 * <form action={…}> nach jeder Aktion ausführt. Bei Fehlern bleiben die Eingaben stehen.
 * Leeren nach Erfolg: Formular per key={state?.zeit} neu aufbauen.
 */
export function useFormularAktion<S>(aktion: (s: Awaited<S>, f: FormData) => Promise<S>) {
  // Startzustand null: vor dem ersten Absenden gibt es keine Rückmeldung
  const [zustand, ausloesen, laeuft] = useActionState(aktion, null as Awaited<S>);
  const state = zustand as Awaited<S> | null;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const daten = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => ausloesen(daten));
  };
  return { state, onSubmit, laeuft };
}

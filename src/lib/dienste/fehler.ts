/** Fachlicher Fehler: Meldung darf an Oberfläche und API-Nutzer gehen. */
export class FachFehler extends Error {
  constructor(meldung: string, public code: "UNGUELTIG" | "KEIN_ZUGRIFF" | "NICHT_GEFUNDEN" = "UNGUELTIG") {
    super(meldung);
  }
}

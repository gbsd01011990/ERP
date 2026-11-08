export const KATEGORIE_TEXT = {
  UMSETZUNG: "Umsetzung",
  FAHRZEIT: "Fahrzeit",
  VOR_ORT_TERMIN: "Vor-Ort-Termin",
  PROJEKTIERUNG: "Projektierung",
  BUEROARBEIT: "Büroarbeit",
  AUFGABE: "Aufgabe",
  PAUSE: "Pause",
  SONSTIGE: "Sonstiges",
} as const;

export type Kategorie = keyof typeof KATEGORIE_TEXT;

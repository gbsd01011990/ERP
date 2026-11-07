export const KATEGORIE = { FAHRZEUG: "Fahrzeug", MASCHINE: "Maschine", ANHAENGER: "Anhänger", KLEINGERAET: "Kleingerät", WERKZEUG: "Werkzeug" } as const;
export const STATUS = {
  VERFUEGBAR: ["verfügbar", "bg-emerald-100 text-emerald-800"],
  IM_EINSATZ: ["im Einsatz", "bg-sky-100 text-sky-800"],
  WERKSTATT: ["Werkstatt", "bg-amber-100 text-amber-800"],
  DEFEKT: ["defekt", "bg-red-100 text-red-700"],
  AUSGEMUSTERT: ["ausgemustert", "bg-slate-200 text-slate-500"],
} as const;
export const PRUEFART = { UVV: "UVV-Prüfung", HU: "Hauptuntersuchung (HU)", AU: "Abgasuntersuchung (AU)", WARTUNG: "Wartung", INSPEKTION: "Inspektion", ELEKTROPRUEFUNG: "Elektroprüfung (DGUV V3)", SONSTIGE: "Sonstige Prüfung" } as const;
export const EREIGNIS = { PRUEFUNG: "Prüfung", WARTUNG: "Wartung", REPARATUR: "Reparatur", SCHADEN: "Schaden", NOTIZ: "Notiz" } as const;
export const AMPEL = {
  ueberfaellig: ["überfällig", "bg-red-100 text-red-700"],
  bald: ["bald fällig", "bg-amber-100 text-amber-800"],
  ok: ["ok", "bg-emerald-100 text-emerald-800"],
  offen: ["kein Termin", "bg-slate-100 text-slate-500"],
} as const;

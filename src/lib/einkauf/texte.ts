export const E_STATUS = { NEU: "neu – Angaben fehlen", PRUEFUNG: "in Prüfung", FREIGEGEBEN: "freigegeben", ABGELEHNT: "abgelehnt", BEZAHLT: "bezahlt" } as const;
export const B_STATUS = { ENTWURF: "Anforderung", BESTELLT: "bestellt", TEILGELIEFERT: "teilgeliefert", GELIEFERT: "geliefert", ABGESCHLOSSEN: "abgeschlossen", STORNIERT: "storniert" } as const;
export const KOSTENART_TEXT = { MATERIAL: "Material", FREMDLEISTUNG: "Fremdleistung", GERAETE: "Geräte/Miete", SONSTIGES: "Sonstiges" } as const;
export const AMPEL = { ok: "bg-emerald-500", hinweis: "bg-emerald-500", warnung: "bg-amber-500", fehler: "bg-red-500" } as const;

/** UN/ECE-Einheitencodes aus E-Rechnungen lesbar machen. */
const EINHEIT: Record<string, string> = { H87: "Stk.", C62: "Stk.", EA: "Stk.", XPP: "Stk.", MTK: "m²", MTQ: "m³", MTR: "m", KMT: "km", HUR: "h", MIN: "min", DAY: "Tag", LS: "psch", KGM: "kg", TNE: "t", LTR: "l", SET: "Satz", WEE: "Woche", MON: "Monat", PR: "Paar", PK: "Pkt.", XBG: "Sack", XPX: "Palette" };
export const einheitText = (code: string | null | undefined) => (code ? EINHEIT[code.toUpperCase()] ?? code : "");

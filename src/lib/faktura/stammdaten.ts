/**
 * Verkäuferangaben für die E-Rechnung je Firma. Quelle: die CD-Dateien der PDF-Generatoren
 * (pdf/gbsd/cd_common.py, pdf/rd/dokument/gve_cd.py, pdf/kud/kud_cd.py). Ändern sich dort
 * Bank, Register oder USt-IdNr., hier mitziehen.
 */
export type Verkaeufer = {
  name: string; strasse: string; plz: string; ort: string; land: "DE";
  telefon: string; email: string; ustId: string; rechtliches: string; kontakt: string;
  iban: string; bic: string; bank: string;
};

export const VERKAEUFER: Record<string, Verkaeufer> = {
  GBSD: {
    name: "GBSD GmbH", strasse: "Am Markt 11b", plz: "14542", ort: "Werder (Havel)", land: "DE",
    telefon: "+49 3327 7407716", email: "info@gbsd-werder.de", ustId: "DE400005532",
    rechtliches: "Amtsgericht Potsdam HRB 40586 P, Geschäftsführer Thorsten Dremel", kontakt: "Thorsten Dremel",
    iban: "DE20100900008001018001", bic: "BEVODEBB", bank: "Berliner Volksbank",
  },
  RD: {
    name: "Riedrich und Dremel GmbH", strasse: "Döberitzer Straße 51", plz: "14612", ort: "Falkensee", land: "DE",
    telefon: "+49 3322 4267242", email: "info@riedrich-dremel.de", ustId: "DE298938482",
    rechtliches: "Amtsgericht Potsdam HRB 27 777 P, Geschäftsführer Thorsten Dremel", kontakt: "Thorsten Dremel",
    iban: "DE04701207001891101915", bic: "OBKLDEMX", bank: "Oberbank AG",
  },
  KUD: {
    name: "Kusche und Dremel GmbH", strasse: "Döberitzer Straße 51", plz: "14612", ort: "Falkensee", land: "DE",
    telefon: "+49 3322 4222383", email: "info@kusche-dremel.de", ustId: "DE298938474",
    rechtliches: "Amtsgericht Potsdam HRB 27 776 P, Geschäftsführer Thorsten Dremel", kontakt: "Thorsten Dremel",
    iban: "DE79701207001891101923", bic: "OBKLDEMX", bank: "Oberbank AG",
  },
};

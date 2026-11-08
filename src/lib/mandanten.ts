/**
 * Erscheinungsbild und Anmeldeadresse je Mandant (Firma).
 * Farben aus den CD-Vorgaben; „farbe“ trägt weiße Schrift (Buttons, Kopfzeile).
 */
export type Mandant = {
  slug: string;
  kuerzel: string;
  name: string;
  zusatz: string;
  logo: string;
  logoBreite: number;
  logoHoehe: number;
  farbe: string;
  farbeDunkel: string;
  farbeHell: string;
  akzent: string;
};

export const MANDANTEN: Mandant[] = [
  {
    slug: "gbsd",
    kuerzel: "GBSD",
    name: "GBSD GmbH",
    zusatz: "Garten- & Landschaftsbau · Baumpflege",
    logo: "/mandanten/gbsd.svg",
    logoBreite: 960,
    logoHoehe: 230,
    farbe: "#1B5E20", // Tannengrün
    farbeDunkel: "#124116",
    farbeHell: "#EAF2E6",
    akzent: "#8BC34A", // Blattgrün
  },
  {
    slug: "riedrich-dremel",
    kuerzel: "RD",
    name: "Riedrich und Dremel GmbH",
    zusatz: "Gärtner von Eden · Garten- & Landschaftsbau",
    logo: "/mandanten/riedrich-dremel.png",
    logoBreite: 640,
    logoHoehe: 427,
    farbe: "#4F7F22", // Eden-Grün, abgedunkelt für weiße Schrift
    farbeDunkel: "#3B5F19",
    farbeHell: "#EEF6E4",
    akzent: "#CF3D73", // Berry
  },
  {
    slug: "kusche-dremel",
    kuerzel: "KUD",
    name: "Kusche und Dremel GmbH",
    zusatz: "Baumdienst",
    logo: "/mandanten/kusche-dremel.png",
    logoBreite: 640,
    logoHoehe: 342,
    farbe: "#764400", // Braun, Pantone 161 C
    farbeDunkel: "#5A3400",
    farbeHell: "#F6EEE4",
    akzent: "#939598",
  },
];

export const mandantNachSlug = (slug: string) => MANDANTEN.find((m) => m.slug === slug) ?? null;
export const mandantNachKuerzel = (kuerzel: string) => MANDANTEN.find((m) => m.kuerzel === kuerzel) ?? null;

/** CSS-Variablen für Tailwind-Farben „marke“ (siehe tailwind.config.ts). */
export const markenStil = (m: Mandant | null) =>
  m ? ({ "--marke": m.farbe, "--marke-dunkel": m.farbeDunkel, "--marke-hell": m.farbeHell, "--akzent": m.akzent } as React.CSSProperties) : undefined;

/** Cookie mit dem zuletzt genutzten Mandanten (für Abmelden und Vorauswahl). */
export const MANDANT_COOKIE = "erp_mandant";

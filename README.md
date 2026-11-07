# ERP

Betriebssoftware für **GBSD GmbH**, **Riedrich und Dremel GmbH** und **Kusche und Dremel GmbH**.
Ersetzt Schritt für Schritt HERO. Rechnungen laufen über Lexware Office, Personal über HRworks,
Belegfotos an DATEV Unternehmen online.

## Stand

Schritt 1 ist fertig:

- Login mit Rollen (Admin, Büro, Kolonne) und Firmenzugriff je Benutzer
- Drei Firmen in einer App, Umschalter „Alle Firmen“ oder eine Firma
- Kontakte (firmenübergreifende Kundenkartei) mit Adressen und Ansprechpartnern
- Projekte mit Pipeline je Firma, Listen- und Board-Ansicht, Suche, Logbuch
- Projektnummern aus Nummernkreisen je Firma (GB-001, RD-001, KD-001)
- Übernahme von Kontakten und Projekten aus HERO (`scripts/hero-import.ts`)

Geplant: Angebote/Aufmaß mit CD-PDF, Lexware-Anbindung, Plantafel, Handy-App für Kolonnen,
HRworks, DATEV, Zusatzwerkzeuge (Radar, GAEB, Baumkataster, Pflegeverträge, Fuhrpark).

## Technik

Next.js 15 (App Router, Server Actions), TypeScript, PostgreSQL mit Prisma, Tailwind CSS.

## Einrichten

```bash
npm install
cp .env.example .env            # DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORT eintragen
npm run db:push                 # Tabellen anlegen
npm run db:seed                 # Firmen, Pipeline, Nummernkreise, erster Admin
npm run dev                     # http://localhost:3000
```

## Daten aus HERO übernehmen

```bash
HERO_API_TOKEN=... npm run import:hero -- --firma GBSD
```

Liest HERO nur. Mehrfach ausführbar: vorhandene Kontakte und Projekte werden aktualisiert,
nicht doppelt angelegt. Unbekannte HERO-Status landen als neue Pipeline-Stufe.
Für Riedrich und Dremel (`--firma RD`) und Kusche und Dremel (`--firma KUD`) mit dem jeweiligen Token.

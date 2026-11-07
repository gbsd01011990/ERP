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

Schritt 2 ist fertig:

- Leistungsstamm je Firma mit Kalkulation (Lohnminuten, Material-EK, Gerät, Fremdleistung) oder Festpreis
- Angebote mit Titeln, Positionen, Hinweistexten, Bedarfspositionen und Versionen
- Kalkulation je Position, Summen mit Stunden, Lohnanteil nach § 35a und Deckungsbeitrag
- Aufmaß je Position (Anzahl × Länge × Breite × Höhe, Abzüge); die Summe wird zur Menge
- Angebot versendet → Projektstatus „Angebot versendet“; angenommen → Auftragsbestätigung als Kopie
- PDF im CD der jeweiligen Firma über die Generatoren aus den CD-Vorgaben (`pdf/`)

Schnittstelle:

- GraphQL-API unter `/api/graphql` mit API-Schlüsseln je Benutzer (lesen oder lesen und schreiben),
  GraphiQL-Editor im Browser. Details in [docs/API.md](docs/API.md).

Geplant: Lexware-Anbindung, Plantafel, Handy-App für Kolonnen, HRworks, DATEV,
Zusatzwerkzeuge (Radar, GAEB, Baumkataster, Pflegeverträge, Fuhrpark).

## PDF-Erzeugung

`pdf/erzeugen.py` nimmt die Belegdaten als JSON und baut das Blatt mit dem Generator der Firma:
`pdf/gbsd/` (GBSD), `pdf/rd/` (Riedrich und Dremel, Gärtner von Eden) und `pdf/kud/` (Kusche und Dremel).
Der Server braucht dafür Python 3 mit `reportlab` und die Liberation-Schriften.

Die Unterschrift von Thorsten Dremel liegt bewusst nicht im Repository. Wer sie unter
Angeboten von Riedrich und Dremel haben möchte, legt `Unterschrift_Thorsten_Dremel.png`
auf dem Server in `pdf/rd/dokument/` ab.

## Technik

Next.js 15 (App Router, Server Actions), TypeScript, PostgreSQL mit Prisma, Tailwind CSS.

## Einrichten

```bash
npm install
cp .env.example .env            # DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORT eintragen
npm run db:push                 # Tabellen anlegen
npm run db:seed                 # Firmen, Pipeline, Nummernkreise, erster Admin
npm run dev                     # http://localhost:3000
npm test                        # Kalkulationstests
```

## Daten aus HERO übernehmen

```bash
HERO_API_TOKEN=... npm run import:hero -- --firma GBSD
```

Liest HERO nur. Mehrfach ausführbar: vorhandene Kontakte und Projekte werden aktualisiert,
nicht doppelt angelegt. Unbekannte HERO-Status landen als neue Pipeline-Stufe.
Für Riedrich und Dremel (`--firma RD`) und Kusche und Dremel (`--firma KUD`) mit dem jeweiligen Token.

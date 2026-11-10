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

Schritt 3 ist fertig:

- **Lager:** mehrere Lager je Firma (Hauptlager, Außenlager, Fahrzeug, Baustelle), Artikel mit Bestand je Lager,
  Zugang, Abgang, Umbuchung, Inventur und Entnahme auf Projekte. Bewertung mit gleitendem Durchschnittspreis,
  Mindestbestand mit Warnung, unveränderliches Lagerjournal. Kein negativer Bestand.
- **Geräte und Maschinen:** Inventar mit Status, Standort, Betriebsstunden, Prüfungen (UVV, HU, AU, Wartung,
  DGUV V3) mit Intervall und Fälligkeitsampel, Historie mit Reparaturkosten, Einsätze auf Projekten.
  Maschinenstundensatz aus Abschreibung, Zins, Reparatur, Fixkosten und Betriebskosten oder als fester Satz.
- **Plankostenrechnung:** Jahresplan je Firma (Personal, Gemeinkosten, Wagnis und Gewinn) ergibt
  Stundenverrechnungssatz und Zuschläge; per Klick in die Angebotskalkulation übernehmen. Nur für Admins.
- **Nachkalkulation im Projekt:** Soll aus Angebot/Auftragsbestätigung gegen Ist aus Lagerentnahmen und
  Geräteeinsätzen. Lohnstunden-Ist folgt mit der Zeiterfassung.
- Übersicht zeigt fällige Prüfungen und Artikel unter Mindestbestand.
- Kolonnen dürfen Material entnehmen, umbuchen, Einsätze und Prüfungen erfassen; Zugang, Inventur,
  Stammdaten und Plankosten bleiben dem Büro bzw. Admin vorbehalten.

GAEB (DA XML 2.0–3.3 über pyGAEB, MIT-Lizenz; `gaeb/gaeb_dienst.py`):

- **Import** im Projekt: X80, X81, X82, X83 (Ausschreibung), X84/X85 (Angebote), X86 (Auftrag → Auftragsbestätigung),
  auch DA XML 2.x (D8x) und GAEB 90 in Grundzügen. Titelhierarchie, Ordnungszahlen, Lang- und Kurztexte,
  Mengen, Bedarfs-, Wahl- und Pauschalpositionen, Preise. Die Originaldatei bleibt am Angebot gespeichert.
- **Export** am Angebot: X84 Angebotsabgabe und X85 Nebenangebot (antworten exakt auf das LV des Auftraggebers:
  gleiche OZ und Kennungen, Einheitspreise, Preisanteile Lohn/Stoffe/Geräte/Sonstiges, Bieteranschrift),
  X86, X80–X83 (z. B. Ausschreibung an Nachunternehmer ohne Preise). Ausgabe immer DA XML 3.3.
- **Mengenermittlung X31** (REB 23.003) ins Aufmaß übernehmen, Zuordnung über die OZ.
- **Preisangebot X94** (auch X93/X96/X97) vom Händler ins Lager: Zuordnung über Artikelnummer/EAN,
  Preis je Einheit (Preisbasis beachtet) als letzter EK.
- Kalkulation aus dem Leistungsstamm auf GAEB-Positionen übernehmen, Texte und OZ bleiben.
- Schemaprüfung jeder Exportdatei, sobald die offiziellen XSD unter `GAEB_XSD_DIR` liegen.
- Noch nicht: X89 Rechnung und X31-Export, GAEB-2000-Textformat (P8x),
  Hinweistexte im Export eigener LVs, Bieterangaben (Fabrikat/Typ) in X84.

E-Mail und CRM:

- Microsoft 365 per App-Berechtigung je Mandant; Admin weist jedem Mitarbeiter sein Postfach zu und
  gibt geteilte Postfächer (info@, rechnung@) einzelnen Mitarbeitern frei. Einrichtung: [deploy/MICROSOFT.md](deploy/MICROSOFT.md).
- Abruf alle 2 Minuten (Dienst `mailabruf`), automatische Zuordnung über Absender/Empfänger zu Kontakt
  und offenem Projekt, Konversationen bleiben zusammen, keine Dubletten über mehrere Postfächer.
- Posteingang für nicht zugeordnete Mails: zuordnen, ausblenden, als neue Anfrage anlegen
  (Kontakt + Projekt + Wiedervorlage), Aufgabe anlegen.
- Senden und Antworten aus dem ERP (eigenes oder freigegebenes Postfach), Angebot als PDF-Anhang
  direkt aus dem Angebot; gesendete Mails landen im Projekt und Logbuch.
- Anfrage am Telefon erfassen (`/anfragen/neu`), Aufgaben und Wiedervorlagen mit Zuständigem und
  Fälligkeit, Kontakt-Zeitleiste mit Notizen, Anrufen, Mails und Projekt-Logbuch.
- Formulare behalten Eingaben bei Fehlermeldungen.

Zeiterfassung:

- Stempeluhr fürs Handy (Ein-/Ausstempeln, Tätigkeit wechseln), Nachtragen von Hand,
  Wochenansicht mit Hinweisen nach Arbeitszeitgesetz (Pausen, über 10 Stunden).
- Regeln: eine laufende Stempeluhr je Mitarbeiter, keine Überschneidungen, höchstens 14 h je
  Eintrag, Projektpflicht bei Umsetzung und Vor-Ort-Termin, Einträge unter 1 Minute werden verworfen.
- Büro: Team-Übersicht je Woche, Freigabe (danach gesperrt), CSV-Export für die Lohnabrechnung.
- Lohnstunden-Ist fließt in die Nachkalkulation der Projekte.
- Alle Zeiten in deutscher Ortszeit (Europe/Berlin), unabhängig von der Server-Zeitzone.
- Benutzerverwaltung für Admins: Mitarbeiter anlegen, Rolle, Mandanten, Passwort zurücksetzen, sperren.

Rechnungen (je Mandant eigener Nummernkreis, eigenes Design):

- Rechnung, Abschlagsrechnung nach Leistungsstand (kumuliert, frühere Abschläge werden einzeln mit
  ihrer Steuer abgezogen) oder nach Zahlungsplan (Prozent der Auftragssumme, je Kostenart getrennt),
  Teilschluss-, Schluss-, Korrektur- und Stornorechnung. Anlegen im Projekt, Grundlage ist das Angebot bzw. die AB.
- Mengennachweis nach REB je Position: Datum, Bezeichnung, Faktoren oder Formel (`12,5*3,2-0,8^2`,
  Klammern, PI, WURZEL), Abzüge; Mengen aus GAEB X31 übernehmen; Mengennachweis als eigenes PDF.
- Sicherheitseinbehalt (VOB/B § 17): bei Abschlägen auf den Rechnungsbetrag, in der Schlussrechnung auf
  die Gesamtleistung; einbehaltene Beträge aus Abschlägen werden dort wieder fällig. Skonto, Zahlungsziel.
- § 35a EStG: Kostenart je Position (Lohn, Maschine, Fahrt, Material, gemischt), Ausweis der
  begünstigten Kosten; § 13b UStG ohne Steuer mit Pflichthinweis; Hinweis bei Anzahlung vor Leistung.
- GoBD: Entwürfe haben keine Nummer. Festschreiben prüft die Pflichtangaben, vergibt die nächste Nummer,
  friert Beträge und Anschrift ein und speichert das PDF. Danach nur noch Storno oder Korrektur;
  eine schon verrechnete Abschlagsrechnung lässt sich erst nach der späteren Rechnung stornieren.
- Nummernkreise frei einstellbar (Einstellungen → Nummernkreise): Präfix mit `{JJJJ}`/`{JJ}`, nächste
  Nummer, Stellen, jährlich neu. GBSD startet bei 2026-114. Belegte Nummern werden abgelehnt.
- **Offene Posten**: Zahlungen buchen (Überweisung, Lastschrift, bar, Skonto, Ausbuchung), Status offen,
  teilweise bezahlt, überfällig; Einbehalte im Blick. Stornierte Rechnungen sind nur bei schon gezahltem Geld offen (Erstattung).
- **Kontoauszug** im Format CAMT.053 einlesen (`bank/camt.py`, nur Python-Standardbibliothek): doppelte Umsätze
  werden erkannt, Eingänge über Rechnungsnummer und Betrag zugeordnet, Skonto innerhalb der Frist erkannt.
- **Mahnwesen**: Zahlungserinnerung (kostenlos), 1. und 2. Mahnung als PDF im CD; Gebühren, Frist und
  Basiszinssatz unter Einstellungen → Buchhaltung; Verzugszinsen nach § 288 BGB ab der Erinnerung,
  Verzugspauschale 40 € nur gegenüber Unternehmern.
- **DATEV-Export** für die Kanzlei: ZIP mit Buchungsstapel (EXTF 700, SKR03; Rechnungen an Debitor gegen
  Erlöskonto, Zahlungen Bank/Kasse/Skonto an Debitor), Debitorenliste und Rechnungs-PDFs. Debitorennummern ab 10000
  je Firma, beim ersten Export vergeben. Den ersten Stapel bitte von der Kanzlei probeweise einlesen lassen.
- **E-Rechnung**: Beim Festschreiben bekommt jedes Rechnungs-PDF eine ZUGFeRD-Datei (CII, EN 16931) eingebettet
  (factur-x, BSD-Lizenz). Sind alle Pflichtangaben da (u. a. E-Mail-Adresse des Kunden, bei § 13b dessen USt-IdNr.),
  entsteht zusätzlich eine XRechnung 3.0 zum Herunterladen. Abschläge stehen als Vorauszahlung (BT-113) in der
  Schlussrechnung; Storno und Gutschriften als Gutschrift (381); Skonto in der XRechnung-Schreibweise.
  Jeder Push prüft neun typische Fälle mit dem amtlichen KoSIT-Validator (GitHub Actions, Job „erechnung“).
  Verkäuferdaten je Firma in `src/lib/faktura/stammdaten.ts`.
- Noch nicht: GAEB X89.

Einkauf (Bestellung → Wareneingang → Eingangsrechnung → Prüfung → Freigabe → Zahlung):

- **Bestellen**: Kolonnen und Büro legen Bestellanforderungen an (im Projekt, im Einkauf oder als
  Bestellvorschlag aus dem Lager unter Mindestbestand). Material und Fremdleistung lassen sich direkt aus der
  Auftragsbestätigung übernehmen. Das Büro löst die Bestellung aus (Nummernkreis BESTELLUNG, Wertgrenze
  einstellbar, darüber ein Admin) und schickt sie als PDF im CD per E-Mail.
- **Wareneingang** je Lieferschein, auch Teillieferungen, mit Foto oder PDF des Lieferscheins; Lagerartikel gehen
  mit dem Bestellpreis ins Lager.
- **Kauf auf Lieferschein** (Kleinmaterial im Baustoffhandel): Foto am Handy (Kamera, im Browser auf 2000 px
  verkleinert), PDF oder E-Mail an ein Postfach mit „Lieferscheineingang“ (z. B. lieferschein@; Nummer aus dem
  Betreff, Händler über den Absender). Kolonnen erfassen und sehen nur ihre eigenen. Dateien werden am Inhalt
  geprüft, doppelte Fotos erkannt. Die Sammelrechnung des Händlers prüft das ERP gegen die Lieferscheine
  (automatische Zuordnung über die Nummer, Summenvergleich); mit der Freigabe sind sie abgerechnet. Direktkäufe
  zählen sofort in der Nachkalkulation des Projekts, die Sammelrechnung nicht noch einmal.
- **Eingangsrechnungen**: Upload oder automatisch aus einem Postfach mit „Rechnungseingang“ (z. B. rechnung@).
  XRechnung (CII und UBL) und ZUGFeRD werden gelesen (factur-x), reine PDFs von Hand erfasst. Lieferant über
  USt-IdNr., IBAN oder Name, Bestellung über die Bestellnummer in der Rechnung.
- **Rechnungsprüfung** automatisch: Pflichtangaben (§ 14 UStG), Rechenweg, Dreiweg-Abgleich (berechnet ≤ geliefert
  ≤ bestellt, Preis höchstens wie bestellt plus Toleranz), doppelte Rechnung, geänderte Bankverbindung.
- **Freigabe**: Büro bis zur Freigabegrenze und ohne Fehler; Fehler übergehen nur ein Admin mit Begründung.
  Ablehnen mit Reklamationsgrund. Zahlungsausgänge im Kontoauszug setzen die Rechnung auf bezahlt.
- Freigegebene Rechnungen fließen in die Nachkalkulation (Material, Fremdleistung, Geräte) und in den
  DATEV-Export (Aufwandskonto an Kreditor ab 70000 mit BU-Schlüssel, Zahlung, Kreditorenliste, Belege).

Telefonagent (je Firma eigener Agent; Einrichtung: [deploy/TELEFONAGENT.md](deploy/TELEFONAGENT.md)):

- Nimmt Anrufe an, wenn im Büro niemand rangeht (Sprachplattform ElevenLabs mit Claude, Nummer bei Twilio,
  Umleitung von der Telekom). Werkzeuge im ERP: Kunde an der Rufnummer erkennen, Anfrage mit Kontakt,
  Projekt und Wiedervorlage anlegen, freie Besichtigungstermine anbieten und buchen, Angebotsstand nennen
  (nur bei bekannter Rufnummer), Rückruf anlegen, Bürozeiten; Weiterverbinden und Notfall über die Plattform.
- Jedes Gespräch mit Verlauf, Zusammenfassung und den Schritten des Agenten unter **Anrufe**; ohne Ergebnis
  entsteht die Aufgabe „Anruf prüfen“. **Termine** zeigt gebuchte und von Hand eingetragene Termine.
- Werkzeuge mit Schlüssel je Firma, Webhook mit HMAC-Signatur; Testkonsole in den Einstellungen.

Messenger (je Firma eigene Zugänge, Einstellungen → Messenger):

- WhatsApp Business (Cloud API von Meta), Telegram-Bot und SMS über Twilio. Eingehende Nachrichten landen
  unter **Kommunikation** (zusammen mit den Anrufen), werden über die Rufnummer dem Kunden zugeordnet und
  lassen sich direkt beantworten. Ein Chat = ein Gespräch; eine neue Nachricht öffnet es wieder.
- Echtheit: Telegram-Geheimnis, Meta-Signatur (App Secret), Twilio-Signatur. Doppelte Zustellungen werden erkannt.
- Außerhalb der Bürozeiten einmal je 12 Stunden eine Abwesenheitsnotiz. WhatsApp-Antworten nur im 24-Stunden-Fenster.
- Schlüssel liegen verschlüsselt (ERP_SCHLUESSEL) und werden nach dem Speichern nie wieder angezeigt.
- Noch nicht: Threema Work (Gateway mit Ende-zu-Ende-Modus), Bilder und Dateien herunterladen.
  Signal und iMessage bieten keine offene Schnittstelle für Firmen.

Mandanten:

- Eigene Anmeldeseite je Firma mit Logo und Farben: `/login/gbsd`, `/login/riedrich-dremel`,
  `/login/kusche-dremel`; `/login` zeigt die Auswahl. Wer sich bei einem Mandanten anmeldet,
  sieht nur dessen Daten. Erscheinungsbild in `src/lib/mandanten.ts`.

Schnittstelle:

- GraphQL-API unter `/api/graphql` mit API-Schlüsseln je Benutzer (lesen oder lesen und schreiben),
  GraphiQL-Editor im Browser. Details in [docs/API.md](docs/API.md).

Geplant: E-Rechnung, offene Posten und DATEV-Export, Telefonagent und Messenger, Plantafel, Handy-App für Kolonnen, HRworks, DATEV,
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

## Betrieb auf dem Server

Docker-Paket (App, PostgreSQL, tägliche Sicherung, HTTPS über Caddy) und automatische
Auslieferung per GitHub Actions. Einrichtung Schritt für Schritt: [deploy/EINRICHTUNG.md](deploy/EINRICHTUNG.md).

## Einrichten für Entwicklung

```bash
npm install
cp .env.example .env            # DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORT eintragen
npm run db:push                 # Tabellen anlegen
npm run db:seed                 # Firmen, Pipeline, Nummernkreise, erster Admin
npm run dev                     # http://localhost:3000
npm test                        # Rechentests
npm run test:integration        # Microsoft-Anbindung gegen nachgebauten Server (braucht Datenbank)
```

## Daten aus HERO übernehmen

```bash
HERO_API_TOKEN=... npm run import:hero -- --firma GBSD
```

Liest HERO nur. Mehrfach ausführbar: vorhandene Kontakte und Projekte werden aktualisiert,
nicht doppelt angelegt. Unbekannte HERO-Status landen als neue Pipeline-Stufe.
Für Riedrich und Dremel (`--firma RD`) und Kusche und Dremel (`--firma KUD`) mit dem jeweiligen Token.

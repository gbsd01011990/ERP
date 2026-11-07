# GraphQL-Schnittstelle

Adresse: `https://<server>/api/graphql` (POST, JSON). Im Browser öffnet dieselbe Adresse
den Abfrage-Editor GraphiQL mit Autovervollständigung und allen Typen; dort gilt die Anmeldung
der App.

## Anmelden

Schlüssel erzeugst du in der App unter **API** (`/einstellungen/api`). Der Schlüssel wird
einmal angezeigt, gespeichert wird nur sein Hash. Jede Anfrage schickt ihn im Header:

```
Authorization: Bearer erp_…
```

Ein Schlüssel hat dieselben Rechte wie der Benutzer, der ihn erzeugt hat: dieselben Firmen,
dieselbe Rolle. Mit „nur lesen“ sind alle Mutationen gesperrt. Widerrufene Schlüssel
bekommen sofort `401`.

## Abfragen

```graphql
# Offene Projekte einer Firma mit Kunde und Status
{
  projekte(firmaId: "…", nurOffen: true, first: 20) {
    gesamt
    eintraege { id nummer titel volumen status { name } kontakt { anzeigename telefon } }
  }
}

# Projekt per Nummer, mit Logbuch und Angeboten samt Summen
{
  projekt(firmaId: "…", nummer: "GB-001") {
    titel
    logbuch(first: 5) { art text benutzer erstelltAm }
    angebote { belegnummer status summen { netto brutto lohnanteilBrutto } pdfPfad }
  }
}

# Firmen mit Pipeline-Status (IDs für projektStatusSetzen)
{ firmen { id kuerzel name pipeline { id name } projektTypen { id name } } }
```

Listen sind seitenweise: `first` (höchstens 200) und `offset`, Antwort mit `gesamt`.

## Ändern

| Mutation | Zweck |
|---|---|
| `kontaktAnlegen(eingabe)` / `kontaktAendern(id, eingabe)` | Kontakt mit Hauptadresse |
| `projektAnlegen(eingabe)` | Projekt im ersten Pipeline-Status, Nummer aus dem Nummernkreis |
| `projektStatusSetzen(projektId, statusId)` | Status wechseln, Logbuch-Eintrag entsteht automatisch |
| `logbuchEintragen(projektId, text, art)` | Notiz, Anruf, E-Mail oder Termin |
| `leistungSpeichern(id?, eingabe)` | Leistung anlegen oder ändern |
| `angebotAnlegen(projektId)` | Angebotsentwurf mit den Standardtexten der Firma |
| `angebotPositionHinzufuegen(angebotId, eingabe)` | Titel, Position (frei oder aus `leistungId`) oder Hinweistext |
| `lagerBuchen(eingabe)` | Zugang, Abgang, Umbuchung, Inventur oder Entnahme auf ein Projekt |
| `geraetEinsatzErfassen(geraetId, eingabe)` | Geräteeinsatz auf ein Projekt mit eingefrorenem Maschinensatz |

Lager und Geräte lesen: `lager(firmaId)`, `artikel(firmaId, suche, nurUnterMindestbestand)`,
`lagerBuchungen(firmaId, artikelId, projektId)`, `geraete(firmaId, status, nurFaellig)`, `geraet(id)`.

Beispiel: Anfrage von der Website als Kontakt und Projekt anlegen.

```graphql
mutation {
  kontaktAnlegen(eingabe: { anrede: "Frau", vorname: "Erika", nachname: "Muster",
                            email: "erika@example.de", strasse: "Gartenweg 3", plz: "14542", ort: "Werder (Havel)" }) { id }
}
mutation {
  projektAnlegen(eingabe: { firmaId: "…", kontaktId: "…", titel: "Heckenschnitt", quelle: "Website" }) { id nummer }
}
```

## Fehler

Fachliche Fehler kommen mit Klartext und Code in `errors[].extensions.code`:

| Code | Bedeutung |
|---|---|
| `NICHT_ANGEMELDET` | Schlüssel fehlt, ist falsch oder widerrufen (HTTP 401) |
| `KEIN_ZUGRIFF` | Firma nicht freigegeben, Rolle reicht nicht oder Schlüssel nur lesend |
| `NICHT_GEFUNDEN` | Datensatz existiert nicht |
| `UNGUELTIG` | Eingabe verletzt eine Regel, z. B. leerer Titel oder doppelte Leistungsnummer |

Interne Fehler werden maskiert („Unexpected error.“) und nur im Serverlog ausgegeben.

## Aufbau im Code

- `src/graphql/typen.graphql.ts` – Schema
- `src/graphql/resolver.ts` – Resolver; sie rufen dieselben Dienste wie die Oberfläche auf
- `src/lib/dienste/` – Geschäftsregeln und Rechteprüfung für Oberfläche und API
- `src/lib/api-schluessel.ts` – Schlüssel erzeugen und prüfen

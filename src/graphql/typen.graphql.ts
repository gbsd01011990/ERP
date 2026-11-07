/** GraphQL-Schema der ERP-Schnittstelle. Feldnamen deutsch, wie in der App. */
export const typeDefs = /* GraphQL */ `
  "Zeitpunkt im ISO-8601-Format, z. B. 2026-11-07T09:30:00.000Z"
  scalar DateTime

  enum Rolle { ADMIN BUERO KOLONNE }
  enum KontaktTyp { KUNDE LIEFERANT PARTNER }
  enum KontaktKategorie { PRIVAT GEWERBE OEFFENTLICH }
  enum AdressArt { HAUPT RECHNUNG BAUSTELLE SONSTIGE }
  enum LogbuchArt { NOTIZ ANRUF EMAIL TERMIN STATUS SYSTEM }
  enum LogbuchEingabeArt { NOTIZ ANRUF EMAIL TERMIN }
  enum BelegArt { ANGEBOT AUFTRAGSBESTAETIGUNG }
  enum BelegStatus { ENTWURF VERSENDET ANGENOMMEN ABGELEHNT ERSETZT }
  enum PositionsArt { GRUPPE POSITION TEXT }

  type Benutzer { id: ID! name: String! email: String! rolle: Rolle! firmen: [Firma!]! }

  type Firma {
    id: ID! kuerzel: String! name: String! zusatz: String ort: String farbe: String!
    stundensatz: Float! materialAufschlag: Float! fremdAufschlag: Float! mwstSatz: Float!
    pipeline: [PipelineStatus!]!
    projektTypen: [ProjektTyp!]!
  }

  type PipelineStatus { id: ID! name: String! reihenfolge: Int! farbe: String! abgeschlossen: Boolean! verloren: Boolean! }
  type ProjektTyp { id: ID! name: String! }

  type Adresse { id: ID! art: AdressArt! strasse: String zusatz: String plz: String ort: String land: String! lat: Float lng: Float }
  type Ansprechpartner { id: ID! name: String! funktion: String telefon: String email: String }

  type Kontakt {
    id: ID! nummer: String typ: KontaktTyp! kategorie: KontaktKategorie!
    "Firmenname oder Vor- und Nachname"
    anzeigename: String!
    firmenname: String anrede: String vorname: String nachname: String
    email: String telefon: String mobil: String web: String leitwegId: String notiz: String
    adressen: [Adresse!]! ansprechpartner: [Ansprechpartner!]!
    "Projekte in den Firmen, auf die der Schlüssel Zugriff hat"
    projekte: [Projekt!]!
    erstelltAm: DateTime! geaendertAm: DateTime!
  }

  type Projekt {
    id: ID! nummer: String! titel: String! beschreibung: String quelle: String volumen: Float
    firma: Firma! status: PipelineStatus! typ: ProjektTyp kontakt: Kontakt! verantwortlich: Benutzer
    baustelleStrasse: String baustellePlz: String baustelleOrt: String lat: Float lng: Float
    heroId: Int
    logbuch(first: Int = 50): [LogbuchEintrag!]!
    angebote: [Angebot!]!
    erstelltAm: DateTime! geaendertAm: DateTime!
  }

  type LogbuchEintrag { id: ID! art: LogbuchArt! text: String! benutzer: String erstelltAm: DateTime! }

  type Leistung {
    id: ID! firma: Firma! nummer: String! kategorie: String kurztext: String! langtext: String einheit: String!
    minuten: Float! materialEk: Float! geraete: Float! fremdEk: Float! festpreis: Float
    "Wirksamer Einzelpreis netto: Festpreis oder Kalkulation mit den Sätzen der Firma"
    einzelpreis: Float!
    aktiv: Boolean!
  }

  type AufmassZeile { id: ID! text: String anzahl: Float laenge: Float breite: Float hoehe: Float abzug: Boolean! ergebnis: Float! }

  type AngebotsPosition {
    id: ID! posNr: String! art: PositionsArt! kurztext: String! langtext: String
    menge: Float! einheit: String! einzelpreis: Float! gesamt: Float!
    preisFest: Boolean! bedarf: Boolean!
    minuten: Float! materialEk: Float! geraete: Float! fremdEk: Float!
    aufmass: [AufmassZeile!]!
  }

  type AngebotSummen { netto: Float! mwst: Float! brutto: Float! lohnanteilNetto: Float! lohnanteilBrutto: Float! stunden: Float! }

  type Angebot {
    id: ID! art: BelegArt! nummer: String! version: Int!
    "Nummer mit Version, wie auf dem PDF"
    belegnummer: String!
    status: BelegStatus! datum: DateTime! gueltigBis: DateTime betreff: String!
    firma: Firma! projekt: Projekt!
    positionen: [AngebotsPosition!]!
    summen: AngebotSummen!
    "Relativer Pfad zum PDF (gleiche Anmeldung erforderlich)"
    pdfPfad: String!
    erstelltAm: DateTime! geaendertAm: DateTime!
  }

  enum LagerArt { HAUPTLAGER AUSSENLAGER FAHRZEUG BAUSTELLE }
  enum BuchungsArt { ZUGANG ABGANG UMBUCHUNG PROJEKT INVENTUR }
  enum GeraetKategorie { FAHRZEUG MASCHINE ANHAENGER KLEINGERAET WERKZEUG }
  enum GeraetStatus { VERFUEGBAR IM_EINSATZ WERKSTATT DEFEKT AUSGEMUSTERT }
  enum PruefArt { UVV HU AU WARTUNG INSPEKTION ELEKTROPRUEFUNG SONSTIGE }
  enum PruefAmpel { ueberfaellig bald ok offen }

  type Lager { id: ID! name: String! art: LagerArt! adresse: String aktiv: Boolean! }
  type LagerBestand { lager: Lager! menge: Float! }
  type Artikel {
    id: ID! nummer: String! bezeichnung: String! kategorie: String einheit: String!
    durchschnittEk: Float! letzterEk: Float mindestbestand: Float lieferant: String aktiv: Boolean!
    bestaende: [LagerBestand!]!
    gesamtbestand: Float!
    "Gesamtbestand × Durchschnitts-EK"
    wert: Float!
    unterMindestbestand: Boolean!
  }
  type LagerBuchung {
    id: ID! art: BuchungsArt! menge: Float! wert: Float! ekPreis: Float
    artikel: Artikel! vonLager: Lager nachLager: Lager projekt: Projekt
    beleg: String notiz: String benutzer: String erstelltAm: DateTime!
  }
  type GeraetPruefung { id: ID! art: PruefArt! bezeichnung: String intervallMonate: Int letzteAm: DateTime naechsteAm: DateTime ampel: PruefAmpel! }
  type Maschinensatz { afa: Float! zins: Float! reparatur: Float! fix: Float! jahreskosten: Float! kalkuliert: Float wirksam: Float! }
  type GeraetEinsatz { id: ID! datum: DateTime! stunden: Float! kostensatz: Float! kosten: Float! projekt: Projekt! notiz: String }
  type Geraet {
    id: ID! inventarNr: String! bezeichnung: String! kategorie: GeraetKategorie! status: GeraetStatus!
    hersteller: String modell: String seriennummer: String kennzeichen: String baujahr: Int
    standort: Lager betriebsstunden: Float kmStand: Int notiz: String
    satz: Maschinensatz!
    pruefungen: [GeraetPruefung!]!
    einsaetze(first: Int = 50): [GeraetEinsatz!]!
  }

  type KontaktSeite { gesamt: Int! eintraege: [Kontakt!]! }
  type ProjektSeite { gesamt: Int! eintraege: [Projekt!]! }
  type LeistungSeite { gesamt: Int! eintraege: [Leistung!]! }
  type AngebotSeite { gesamt: Int! eintraege: [Angebot!]! }

  type Query {
    "Der Benutzer, dem der API-Schlüssel gehört"
    ich: Benutzer!
    firmen: [Firma!]!
    kontakte(suche: String, typ: KontaktTyp, first: Int = 50, offset: Int = 0): KontaktSeite!
    kontakt(id: ID!): Kontakt
    projekte(firmaId: ID, suche: String, statusName: String, kontaktId: ID, nurOffen: Boolean = false, first: Int = 50, offset: Int = 0): ProjektSeite!
    "Projekt per id oder per firmaId + nummer"
    projekt(id: ID, firmaId: ID, nummer: String): Projekt
    leistungen(firmaId: ID, suche: String, nurAktiv: Boolean = true, first: Int = 100, offset: Int = 0): LeistungSeite!
    angebote(firmaId: ID, projektId: ID, status: BelegStatus, art: BelegArt, first: Int = 50, offset: Int = 0): AngebotSeite!
    angebot(id: ID!): Angebot
    lager(firmaId: ID!): [Lager!]!
    artikel(firmaId: ID!, suche: String, nurUnterMindestbestand: Boolean = false): [Artikel!]!
    lagerBuchungen(firmaId: ID!, artikelId: ID, projektId: ID, first: Int = 50, offset: Int = 0): [LagerBuchung!]!
    geraete(firmaId: ID!, status: GeraetStatus, nurFaellig: Boolean = false): [Geraet!]!
    geraet(id: ID!): Geraet
  }

  input KontaktEingabe {
    typ: KontaktTyp = KUNDE kategorie: KontaktKategorie = PRIVAT
    firmenname: String anrede: String vorname: String nachname: String
    email: String telefon: String mobil: String leitwegId: String notiz: String
    strasse: String plz: String ort: String
  }

  input ProjektEingabe {
    firmaId: ID! kontaktId: ID! titel: String! typId: ID quelle: String beschreibung: String volumen: Float
    baustelleStrasse: String baustellePlz: String baustelleOrt: String
  }

  input LeistungEingabe {
    firmaId: ID! nummer: String! kurztext: String! kategorie: String langtext: String einheit: String
    minuten: Float = 0 materialEk: Float = 0 geraete: Float = 0 fremdEk: Float = 0 festpreis: Float aktiv: Boolean = true
  }

  input PositionEingabe {
    art: PositionsArt = POSITION
    "Übernimmt Texte und Kalkulation aus dem Leistungsstamm"
    leistungId: ID
    kurztext: String langtext: String menge: Float einheit: String
    minuten: Float materialEk: Float geraete: Float fremdEk: Float
    "Fester Einzelpreis; ohne Angabe wird kalkuliert"
    einzelpreis: Float
    bedarf: Boolean
  }

  input LagerBuchungEingabe {
    art: BuchungsArt! artikelId: ID!
    "Menge; bei INVENTUR der gezählte Bestand"
    menge: Float!
    vonLagerId: ID nachLagerId: ID
    "Pflicht bei ZUGANG"
    ekPreis: Float
    "Pflicht bei PROJEKT"
    projektId: ID
    beleg: String notiz: String
  }

  input GeraetEinsatzEingabe { projektId: ID! datum: DateTime! stunden: Float! notiz: String }

  type Mutation {
    kontaktAnlegen(eingabe: KontaktEingabe!): Kontakt!
    kontaktAendern(id: ID!, eingabe: KontaktEingabe!): Kontakt!
    projektAnlegen(eingabe: ProjektEingabe!): Projekt!
    projektStatusSetzen(projektId: ID!, statusId: ID!): Projekt!
    logbuchEintragen(projektId: ID!, text: String!, art: LogbuchEingabeArt = NOTIZ): LogbuchEintrag!
    leistungSpeichern(id: ID, eingabe: LeistungEingabe!): Leistung!
    "Legt ein Angebot als Entwurf mit den Standardtexten der Firma an"
    angebotAnlegen(projektId: ID!): Angebot!
    "Hängt eine Position an einen Angebotsentwurf an"
    angebotPositionHinzufuegen(angebotId: ID!, eingabe: PositionEingabe!): Angebot!
    "Lagerbewegung buchen; Bestand darf nicht negativ werden"
    lagerBuchen(eingabe: LagerBuchungEingabe!): LagerBuchung!
    "Geräteeinsatz auf ein Projekt; der aktuelle Maschinensatz wird eingefroren"
    geraetEinsatzErfassen(geraetId: ID!, eingabe: GeraetEinsatzEingabe!): GeraetEinsatz!
  }
`;

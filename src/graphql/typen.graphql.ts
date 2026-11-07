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
  }
`;

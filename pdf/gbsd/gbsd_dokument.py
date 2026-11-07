# -*- coding: utf-8 -*-
"""Blattlayout GBSD GmbH – ein Bogen für alle Dokumente.

Maße und Farben stammen aus der Auftragsbestätigung AB-2026-082 (Referenzblatt).
Das Modul baut Angebote, Auftragsbestätigungen, Briefe, Aufmaße, Lieferscheine
und Protokolle auf demselben Satzspiegel.

Aufbau:

    from cd_common import register_fonts
    from gbsd_dokument import GBSDDokument, SPALTEN_PREISE

    d = GBSDDokument("AB-2026-082.pdf",
                     empfaenger=["Familie Poeschel", "Karl-Foerster-Straße 5",
                                 "14542 Werder (Havel)"],
                     infos=[("Auftragsbestätigung Nr.:", "AB-2026-082", True),
                            ("Datum:", "21.08.2026")])
    d.betreff("Auftragsbestätigung – Ausbesserung der Einfahrt")
    d.absatz("Sehr geehrte Frau Poeschel,")
    d.absatz("vielen Dank für Ihren Auftrag …", abstand=0)
    d.tabelle(SPALTEN_PREISE, positionen)
    d.summen([("Auftragssumme netto", "1.153,40 €"),
              ("zzgl. 19 % Umsatzsteuer", "219,15 €"),
              ("Auftragssumme brutto", "1.372,55 €")])
    d.abschnitt("Konditionen", [("Zahlung", "50 % Anzahlung …")])
    d.gruss()
    d.speichern()

Der Satz läuft in zwei Durchgängen: der erste zählt die Seiten, der zweite
schreibt sie mit der richtigen Seitenzahl. Deshalb sammeln die Methoden nur
Blöcke ein; gezeichnet wird erst in speichern().
"""

import os
import sys

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cd_common import (  # noqa: E402
    TANNE, BLATTHELL, WALD, SAND, ANTHRAZIT, STEIN, WEISS,
    FIRMA, register_fonts, draw_wortmarke,
)

# ---------------------------------------------------------------- Blattmaße --
SEITE_B, SEITE_H = 595.2756, 841.8898     # A4 hoch
LINKS = 62.3623                            # 22 mm
RECHTS = 544.2519                          # 18 mm Rand
BREITE = RECHTS - LINKS                    # 481.89 pt

# Kopf
LOGO_BASIS = 777.8898                      # Grundlinie der Wortmarke
LOGO_HOEHE = 24                            # Versalhöhe „GBSD“
ABSENDER_Y = 799.8898                      # erste Zeile des Absenderblocks
ABSENDER_SCHRITT = 10.5
TRENNLINIE_Y = 745.8898
RUECKSENDE_Y = 713.8898                    # kleine Absenderzeile über der Anschrift
EMPFAENGER_Y = 695.8898                    # erste Zeile Empfängeranschrift
EMPFAENGER_SCHRITT = 14
INFO_X = 344.2519                          # Label-Spalte im Informationsblock
BETREFF_Y = 615.8898
TEXT_Y = 593.8898                          # erste Textzeile auf Seite 1
FOLGESEITE_Y = 700                         # erste Textzeile auf Folgeseiten
UNTERKANTE = 78                            # tiefste Grundlinie über der Fußzeile
FUSSLINIE_Y = 56.693                       # 20 mm

# Schriftgrade
GR_TEXT = 9.5
DL_TEXT = 12.5                             # Zeilenabstand Fließtext
GR_KLEIN = 8.8
DL_KLEIN = 10.5
GR_TABELLE = 9
GR_KOPFZEILE = 8.5
GR_FUSS = 6.4

REG, BOLD = "LSans", "LSans-B"


# ------------------------------------------------------------------ Spalten --
class Spalte:
    """Eine Tabellenspalte. x und breite sind Abstände ab dem linken Rand.

    ausricht 'l' setzt links ab x, 'r' setzt rechts an x. Die Spalte mit
    fliess=True nimmt den Positionstext auf und trägt die Beschreibungszeilen.
    """

    def __init__(self, key, label, x, breite=0, ausricht="l", fliess=False):
        self.key = key
        self.label = label
        self.x = LINKS + x
        self.breite = breite
        self.ausricht = ausricht
        self.fliess = fliess


SPALTEN_PREISE = [
    Spalte("pos", "Pos.", 0),
    Spalte("text", "Leistung", 34, 208, fliess=True),
    Spalte("menge", "Menge", 276.8896, ausricht="r"),
    Spalte("einheit", "Einheit", 286.8896),
    Spalte("preis", "Einzelpreis €", 396.8896, ausricht="r"),
    Spalte("gesamt", "Gesamt €", 481.8896, ausricht="r"),
]

SPALTEN_MENGEN = [            # Aufmaß, Lieferschein: keine Preise
    Spalte("pos", "Pos.", 0),
    Spalte("text", "Leistung", 34, 300, fliess=True),
    Spalte("menge", "Menge", 400, ausricht="r"),
    Spalte("einheit", "Einheit", 410),
]

SPALTEN_PROTOKOLL = [         # Baumkontrolle nach FLL
    Spalte("pos", "Nr.", 0),
    Spalte("text", "Baum / Standort", 28, 118, fliess=True),
    Spalte("befund", "Befund", 152, 140),
    Spalte("massnahme", "Maßnahme", 300, 110),
    Spalte("frist", "Frist", 420, 62),
]


# ----------------------------------------------------------------- Dokument --
class GBSDDokument:
    def __init__(self, pfad, empfaenger=None, infos=None, rueckadresse=True,
                 falzmarken=False):
        self.pfad = pfad
        self.empfaenger = empfaenger or []
        self.infos = infos or []           # (Label, Wert) oder (Label, Wert, fett)
        self.rueckadresse = rueckadresse
        self.falzmarken = falzmarken
        self.bloecke = []
        register_fonts()

    # ---- Inhalte sammeln -------------------------------------------------
    def betreff(self, text):
        self.bloecke.append(("betreff", text))

    def absatz(self, text, abstand=5, groesse=GR_TEXT, farbe=ANTHRAZIT, fett=False):
        self.bloecke.append(("absatz", text, abstand, groesse, farbe, fett))

    def abstand(self, hoehe):
        self.bloecke.append(("abstand", hoehe))

    def tabelle(self, spalten, zeilen):
        """zeilen: Liste von dicts mit den Spalten-Keys, optional 'beschreibung'."""
        self.bloecke.append(("tabelle", spalten, zeilen))

    def summen(self, zeilen):
        """zeilen: [(Label, Betrag), …]. Die letzte Zeile steht fett in Tannengrün."""
        self.bloecke.append(("summen", zeilen))

    def abschnitt(self, titel, eintraege):
        """eintraege: [(Zwischenzeile, Text), …] oder [Text, …] ohne Zwischenzeile."""
        self.bloecke.append(("abschnitt", titel, eintraege))

    def hinweis(self, titel, text):
        """Naturweißer Kasten mit Blattgrün-Kante – für Steuer- oder Rechtshinweise."""
        self.bloecke.append(("hinweis", titel, text))

    def unterschriften(self, links, rechts=None):
        """Zwei Unterschriftslinien nebeneinander – für Aufmaß und Lieferschein."""
        self.bloecke.append(("unterschriften", links, rechts))

    def gruss(self, formel="Mit freundlichen Grüßen", name=None, funktion=None):
        self.bloecke.append(("gruss", formel,
                             name or FIRMA["gf"],
                             funktion if funktion is not None else "Geschäftsführer " + FIRMA["name"]))

    # ---- Satz ------------------------------------------------------------
    def speichern(self):
        seiten = self._lauf(zeichnen=False)
        self._lauf(zeichnen=True, seiten_gesamt=seiten)
        return self.pfad

    def _lauf(self, zeichnen, seiten_gesamt=0):
        self.c = canvas.Canvas(self.pfad if zeichnen else os.devnull,
                               pagesize=(SEITE_B, SEITE_H))
        self.zeichnen = zeichnen
        self.seiten_gesamt = seiten_gesamt
        self.seite = 1
        self._kopf(erste=True)
        self.y = BETREFF_Y
        self._tab_grundlinie = None   # letzte Beschreibungszeile der Tabelle
        self._tab_rechts = None

        for block in self.bloecke:
            getattr(self, "_b_" + block[0])(*block[1:])

        self._fuss()
        if zeichnen:
            self.c.save()
        return self.seite

    # ---- Seitenrahmen ----------------------------------------------------
    def _kopf(self, erste):
        c = self.c
        draw_wortmarke(c, LINKS, LOGO_BASIS, LOGO_HOEHE)

        zeilen = [
            FIRMA["name"],
            "%s · %s" % (FIRMA["strasse"], FIRMA["ort"]),
            "Telefon " + FIRMA["tel"],
            "%s · %s" % (FIRMA["mail"], FIRMA["web"]),
        ]
        c.setFont(REG, 8)
        c.setFillColor(STEIN)
        for i, z in enumerate(zeilen):
            c.drawRightString(RECHTS, ABSENDER_Y - i * ABSENDER_SCHRITT, z)

        c.setStrokeColor(TANNE)
        c.setLineWidth(1.4)
        c.line(LINKS, TRENNLINIE_Y, RECHTS, TRENNLINIE_Y)

        if self.falzmarken:
            c.setStrokeColor(STEIN)
            c.setLineWidth(0.4)
            for mm in (105, 210):
                y = SEITE_H - mm * 72 / 25.4
                c.line(LINKS - 28, y, LINKS - 17, y)
            y = SEITE_H - 148.5 * 72 / 25.4
            c.line(LINKS - 31, y, LINKS - 14, y)

        if not erste:
            return

        if self.rueckadresse:
            c.setFont(REG, 6.5)
            c.setFillColor(STEIN)
            c.drawString(LINKS, RUECKSENDE_Y, "%s · %s · %s"
                         % (FIRMA["name"], FIRMA["strasse"], FIRMA["ort"]))

        c.setFont(REG, 10)
        c.setFillColor(ANTHRAZIT)
        for i, z in enumerate(self.empfaenger):
            c.drawString(LINKS, EMPFAENGER_Y - i * EMPFAENGER_SCHRITT, z)

        for i, eintrag in enumerate(self.infos):
            label, wert = eintrag[0], eintrag[1]
            fett = len(eintrag) > 2 and eintrag[2]
            y = EMPFAENGER_Y - i * EMPFAENGER_SCHRITT
            c.setFont(REG, GR_TEXT)
            c.setFillColor(ANTHRAZIT)
            c.drawString(INFO_X, y, label)
            c.setFont(BOLD if fett else REG, GR_TEXT)
            c.drawRightString(RECHTS, y, wert)

    def _fuss(self):
        c = self.c
        c.setStrokeColor(STEIN)
        c.setLineWidth(0.6)
        c.line(LINKS, FUSSLINIE_Y, RECHTS, FUSSLINIE_Y)

        spalten = [
            (LINKS, FIRMA["name"], [FIRMA["strasse"], FIRMA["ort"]]),
            (LINKS + 120, "Kontakt", ["Telefon " + FIRMA["tel"], FIRMA["mail"], FIRMA["web"]]),
            (LINKS + 250, "Gesellschaft", ["Geschäftsführer: " + FIRMA["gf"],
                                           FIRMA["register"], FIRMA["ustid"]]),
            (LINKS + 388, "Bankverbindung", [FIRMA["bank"], FIRMA["iban"], FIRMA["bic"]]),
        ]
        for x, titel, zeilen in spalten:
            c.setFont(BOLD, GR_FUSS)
            c.setFillColor(WALD)
            c.drawString(x, 47.693, titel)
            c.setFont(REG, GR_FUSS)
            c.setFillColor(STEIN)
            for i, z in enumerate(zeilen):
                c.drawString(x, 39.693 - i * 8, z)

        c.setFont(REG, GR_FUSS)
        c.setFillColor(STEIN)
        text = "Seite %d" % self.seite
        if self.seiten_gesamt > 1:
            text = "Seite %d von %d" % (self.seite, self.seiten_gesamt)
        c.drawRightString(RECHTS, 22.6772, text)

    def _umbruch(self):
        self._fuss()
        self.c.showPage()
        self.seite += 1
        self._kopf(erste=False)
        self.y = FOLGESEITE_Y
        self._tab_grundlinie = None
        self._tab_rechts = None

    def _platz(self, hoehe):
        """Sorgt dafür, dass hoehe Punkte unterhalb der Marke y frei sind."""
        if self.y - hoehe < UNTERKANTE:
            self._umbruch()

    # ---- Hilfen ----------------------------------------------------------
    def _umbrechen(self, text, breite, groesse, font=REG):
        worte, zeilen, zeile = str(text).split(), [], ""
        for wort in worte:
            probe = (zeile + " " + wort).strip()
            if pdfmetrics.stringWidth(probe, font, groesse) <= breite or not zeile:
                zeile = probe
            else:
                zeilen.append(zeile)
                zeile = wort
        if zeile:
            zeilen.append(zeile)
        return zeilen or [""]

    def _zeile(self, x, text, groesse, farbe, fett=False, rechts=False):
        c = self.c
        c.setFont(BOLD if fett else REG, groesse)
        c.setFillColor(farbe)
        (c.drawRightString if rechts else c.drawString)(x, self.y, text)

    # ---- Blocktypen ------------------------------------------------------
    def _b_betreff(self, text):
        # Der Betreff steht am liebsten auf einer Zeile. Passt er knapp nicht,
        # wird er bis 11,5 pt verkleinert; erst darunter bricht er um.
        groesse = 12.5
        while (groesse > 11.5
               and pdfmetrics.stringWidth(text, BOLD, groesse) > BREITE):
            groesse -= 0.25
        zeilen = self._umbrechen(text, BREITE, groesse, BOLD)
        self._platz(15 * len(zeilen) + 22)
        for z in zeilen:
            self._zeile(LINKS, z, groesse, TANNE, fett=True)
            self.y -= 15
        self.y -= 7      # Betreff 615.89 → erste Textzeile 593.89

    def _b_absatz(self, text, vorher, groesse, farbe, fett):
        breite = BREITE
        zeilen = self._umbrechen(text, breite, groesse, BOLD if fett else REG)
        dl = DL_TEXT if groesse >= GR_TEXT else DL_KLEIN
        self.y -= vorher
        self._platz(dl * len(zeilen))
        for z in zeilen:
            self._zeile(LINKS, z, groesse, farbe, fett=fett)
            self.y -= dl

    def _b_abstand(self, hoehe):
        self.y -= hoehe

    def _b_tabelle(self, spalten, zeilen):
        # Der vorige Absatz hat seinen Durchschuss schon abgezogen; 5 pt zurück
        # ergeben die 7,5 pt Luft zwischen letzter Textzeile und Kopfbalken.
        self.y += 5
        self._platz(46)
        self._tabellenkopf(spalten)
        for zeile in zeilen:
            self._tabellenzeile(spalten, zeile)

    def _tabellenkopf(self, spalten):
        c = self.c
        oben = self.y
        c.setFillColor(TANNE)
        c.rect(LINKS, oben - 16, BREITE, 16, stroke=0, fill=1)
        c.setFillColor(WEISS)
        c.setFont(BOLD, GR_KOPFZEILE)
        for s in spalten:
            if s.ausricht == "r":
                # 3 pt Luft, sonst klebt das €-Zeichen an der Balkenkante
                c.drawRightString(s.x - 3, oben - 12, s.label)
            else:
                c.drawString(s.x + (3 if s.x == LINKS else 0), oben - 12, s.label)
        self.y = oben - 33      # erste Positionsgrundlinie

    def _zeilenhoehe(self, spalten, zeile):
        hoehe = 16.2
        text_sp = next((s for s in spalten if s.fliess), None)
        if text_sp:
            titel = self._umbrechen(zeile.get(text_sp.key, ""), text_sp.breite,
                                    GR_TABELLE, BOLD)
            hoehe += (len(titel) - 1) * 11.2
            besch = zeile.get("beschreibung")
            if besch:
                n = 0
                for teil in str(besch).split("\n"):
                    n += len(self._umbrechen(teil, text_sp.breite, GR_KLEIN))
                hoehe += 12.5 + (n - 1) * 11.2
        for s in spalten:
            if s.fliess or not s.breite:
                continue
            n = len(self._umbrechen(zeile.get(s.key, ""), s.breite, GR_TABELLE))
            hoehe = max(hoehe, 16.2 + (n - 1) * 11.2)
        return hoehe

    def _tabellenzeile(self, spalten, zeile):
        hoehe = self._zeilenhoehe(spalten, zeile)
        if self.y - hoehe < UNTERKANTE:
            self._umbruch()
            self._tabellenkopf(spalten)

        text_sp = next((s for s in spalten if s.fliess), None)
        kopf_y = self.y
        for s in spalten:
            wert = zeile.get(s.key, "")
            if wert == "" or s is text_sp:
                continue
            self.y = kopf_y
            if s.breite:
                for z in self._umbrechen(wert, s.breite, GR_TABELLE):
                    self._zeile(s.x, z, GR_TABELLE, ANTHRAZIT)
                    self.y -= 11.2
            else:
                self._zeile(s.x, str(wert), GR_TABELLE, ANTHRAZIT,
                            rechts=(s.ausricht == "r"))

        self.y = kopf_y
        if text_sp:
            titel = self._umbrechen(zeile.get(text_sp.key, ""), text_sp.breite,
                                    GR_TABELLE, BOLD)
            for z in titel:
                self._zeile(text_sp.x, z, GR_TABELLE, ANTHRAZIT, fett=True)
                self._merke_zeile(text_sp.x, z, GR_TABELLE, BOLD)
                self.y -= 11.2
            besch = zeile.get("beschreibung")
            if besch:
                self.y = kopf_y - 12.5 - (len(titel) - 1) * 11.2
                for teil in str(besch).split("\n"):
                    for z in self._umbrechen(teil, text_sp.breite, GR_KLEIN):
                        self._zeile(text_sp.x, z, GR_KLEIN, ANTHRAZIT)
                        self._merke_zeile(text_sp.x, z, GR_KLEIN, REG)
                        self.y -= 11.2
        self.y = kopf_y - hoehe

    def _merke_zeile(self, x, text, groesse, font):
        """Merkt sich, wo die letzte Textzeile der Tabelle endet.

        Der Summenblock darf neben einer kurzen Schlusszeile hochrutschen –
        so bleibt das Blatt kompakt, ohne dass sich Text und Fläche berühren.
        """
        self._tab_grundlinie = self.y
        self._tab_rechts = x + pdfmetrics.stringWidth(text, font, groesse)

    def _b_summen(self, zeilen):
        n_normal = max(len(zeilen) - 1, 0)
        hoehe = 16 + 17 * max(n_normal - 1, 0) + 21 + 26
        x = LINKS + 204.8896      # linke Kante des Summenkastens
        breite = RECHTS - x       # endet bündig am rechten Satzspiegel
        # Die letzte Tabellenzeile hat ihren Durchschuss schon verbraucht.
        self.y += 10
        if self._tab_rechts is not None and self._tab_rechts < x - 8:
            self.y = max(self.y, self._tab_grundlinie + 2)
        self._platz(hoehe)
        c = self.c
        oben = self.y
        c.setFillColor(SAND)
        c.rect(x, oben - hoehe, breite, hoehe, stroke=0, fill=1)

        y = oben - 16
        for i, (label, betrag) in enumerate(zeilen):
            letzte = i == len(zeilen) - 1
            if letzte and i:
                y -= 4          # etwas mehr Luft vor der Endsumme
            c.setFont(BOLD if letzte else REG, 11.2 if letzte else 9.8)
            c.setFillColor(TANNE if letzte else ANTHRAZIT)
            c.drawString(x + 12, y, label)
            c.drawRightString(RECHTS - 12, y, betrag)
            y -= 17
        self.y = oben - hoehe

    def _b_abschnitt(self, titel, eintraege):
        self.y -= 18
        self._platz(30)
        self._zeile(LINKS, titel, 10.5, TANNE, fett=True)
        self.y -= 12
        for eintrag in eintraege:
            if isinstance(eintrag, (tuple, list)):
                zwischen, text = eintrag
            else:
                zwischen, text = None, eintrag
            if zwischen:
                self._platz(24)
                self._zeile(LINKS, zwischen, 9, WALD, fett=True)
                self.y -= 11
            zeilen = self._umbrechen(text, BREITE, GR_KLEIN)
            self._platz(DL_KLEIN * len(zeilen))
            for z in zeilen:
                self._zeile(LINKS, z, GR_KLEIN, ANTHRAZIT)
                self.y -= DL_KLEIN
            self.y -= 2

    def _b_hinweis(self, titel, text):
        zeilen = self._umbrechen(text, BREITE - 24, GR_KLEIN)
        hoehe = 20 + DL_KLEIN * len(zeilen) + 8
        self.y -= 12
        self._platz(hoehe)
        c = self.c
        oben = self.y
        c.setFillColor(SAND)
        c.rect(LINKS, oben - hoehe, BREITE, hoehe, stroke=0, fill=1)
        c.setFillColor(BLATTHELL)
        c.rect(LINKS, oben - hoehe, 3, hoehe, stroke=0, fill=1)
        self.y = oben - 16
        self._zeile(LINKS + 12, titel, 9, WALD, fett=True)
        self.y -= 12
        for z in zeilen:
            self._zeile(LINKS + 12, z, GR_KLEIN, ANTHRAZIT)
            self.y -= DL_KLEIN
        self.y = oben - hoehe - 8

    def _b_unterschriften(self, links, rechts):
        self.y -= 34
        self._platz(24)
        c = self.c
        breite = 200
        spalten = [(LINKS, links)]
        if rechts:
            spalten.append((LINKS + 250, rechts))
        c.setStrokeColor(STEIN)
        c.setLineWidth(0.6)
        for x, label in spalten:
            c.line(x, self.y, x + breite, self.y)
            self._zeile_bei(x, self.y - 10, label, 8.5, STEIN)
        self.y -= 22

    def _zeile_bei(self, x, y, text, groesse, farbe, fett=False):
        self.c.setFont(BOLD if fett else REG, groesse)
        self.c.setFillColor(farbe)
        self.c.drawString(x, y, text)

    def _b_gruss(self, formel, name, funktion):
        # Der Vorabsatz hat seinen Durchschuss schon abgezogen; zusammen
        # ergeben sich die 16 pt Luft vor der Grußformel.
        self.y -= 4
        self._platz(30)
        self._zeile(LINKS, formel, GR_TEXT, ANTHRAZIT)
        self.y -= 20
        self._zeile(LINKS, name, GR_TEXT, ANTHRAZIT, fett=True)
        self.y -= 10
        if funktion:
            self._zeile(LINKS, funktion, 8.5, STEIN)
            self.y -= 12

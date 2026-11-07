# -*- coding: utf-8 -*-
"""
Blattgenerator Kusche und Dremel GmbH.

Baut Angebot, Auftragsbestätigung, Rechnung, Lieferschein, Aufmaß und Brief
auf demselben Blatt. Sämtliche Maße stammen aus dem Referenzdokument
"Angebot MUSTER.pdf" (FastReport, 20.08.2026) und sind dort nachgemessen.
Nullpunkt unten links, A4 hoch, 595,28 x 841,89 pt.

Kurzform:

    from kud_dokument import KuDDokument

    d = KuDDokument("Angebot.pdf", dokumentart="Angebot",
                    belegnummer="26147-01-002",
                    empfaenger=["Frau", "Julia Grauel", "Jänickestraße 105a", "14167 Berlin"],
                    kundennummer="10682", ansprechpartner="Andrea Trabus",
                    datum="20.08.2026",
                    betreff="BV: Jänickestraße 105a, 14167 Berlin - Baumpflege")
    d.anrede("Sehr geehrte Frau Grauel,")
    d.absatz("wir bedanken uns für die Anfrage …")
    d.vorbemerkung([...])
    d.tabelle()
    d.hauptposition("01", "An- und Abfahrt")
    d.position("01.01", "An- und Abfahrtspauschale", ["je Arbeitstag und Kolonne"],
               1.0, "Stk.", 192.72)
    d.gruppensumme()
    d.zusammenstellung()
    d.schluss()
    d.auftragsformular()
    d.widerrufsbelehrung()
    d.speichern()
"""

import os
from reportlab.pdfgen import canvas as rl_canvas

from kud_cd import (SEITE_B, SEITE_H, SCHWARZ, WEISS, GRAU_TEXT, FIRMA, BANKEN,
                    RUECKSENDE, TRENNER, register_fonts, text, breite,
                    umbrechen, zahl, draw_logo, draw_verbandslogos)

# ------------------------------------------------------------- Satzspiegel
LINKS = 68.03           # linker Rand für Fließtext, Anschrift, Betreff
POS_X = 69.63           # Spalte Positionsnummer und Überschriften der Tabelle
TEXT_X = 153.08         # Spalte Leistungsbeschreibung
DETAIL_WERT_X = 225.08  # Wertspalte in den Detailzeilen einer Hauptposition
MENGE_R = 352.70        # Menge, rechtsbündig
EINHEIT_X = 355.50      # Einheit, linksbündig
EP_R = 466.68           # Einheitspreis, rechtsbündig
GES_R = 559.95          # Gesamtbetrag, rechtsbündig
SUMME_R = 559.81        # Gruppensumme, rechtsbündig
ZUSAMMEN_R = 559.68     # Zusammenstellung, rechtsbündig
INFO_X = 448.63         # Absenderblock und Fußblock rechts
INFO_WERT_X = 465.36    # Werte hinter "Tel.:" und "Fax:"
TAB_L, TAB_R = 68.03, 561.61        # Linie unter dem Tabellenkopf
SUM_L, SUM_R = 471.02, 560.61       # Linie über einer Gruppensumme
SEITENZAHL_R = 574.57   # Seitenzahl der Folgeseiten, rechtsbündig

# -------------------------------------------------------------- Grundlinien
Y_RUECKSENDE = 696.09
Y_ANSCHRIFT = 679.69
Y_DOKUMENTART_S1 = 543.60
Y_BELEG_S1 = 530.50
Y_BETREFF = 514.90
Y_ANREDE = 472.29
Y_TEXT_S1 = 446.80
Y_FUSSBLOCK = 129.12
Y_SEITENZAHL_S1 = 31.59
Y_SEITENZAHL_FOLGE = 810.93
Y_DOKUMENTART_FOLGE = 779.30
Y_BELEG_FOLGE = 764.22
Y_TABELLENKOPF = 712.31
Y_TABELLENLINIE = 703.80
Y_ERSTE_POSITION = 689.92

# ------------------------------------------------------------------ Abstände
ZEILE = 12.735          # Grundschritt 10 pt Text
ZEILE_EINZUG = 11.99    # Schritt im eingerückten Vorbemerkungsblock
ABSATZ = 25.49          # Abstand zwischen zwei Absätzen
HAUPT_ZU_UNTER = 31.76  # Hauptposition zur ersten Unterposition
MENGE_ZU_LINIE = 9.08   # Mengenzeile zur Summenlinie
LINIE_ZU_SUMME = 10.76  # Summenlinie zur Summenzeile
SUMME_ZU_HAUPT = 19.85  # Gruppensumme zur nächsten Hauptposition
FOTO_OBEN = 5.94        # letzte Grundlinie zur Fotooberkante
FOTO_UNTEN = 39.72      # Fotounterkante zur nächsten Unterposition
INFO_SCHRITT = 9.59     # Zeilenschritt in Absender- und Fußblock
MIN_Y = 70.0            # tiefste zulässige Grundlinie im Textteil

FOTO_KANTE = 170.08     # 6 cm, Standardgröße der Positionsfotos
EINZUG_BREITE = 383.5   # Satzbreite des eingerückten Vorbemerkungsblocks


class _Blatt(rl_canvas.Canvas):
    """Canvas, der die Seitenzahl erst beim Speichern setzt – vorher ist die
    Gesamtzahl der Seiten nicht bekannt."""

    def __init__(self, *args, **kwargs):
        rl_canvas.Canvas.__init__(self, *args, **kwargs)
        self._zustaende = []

    def showPage(self):
        self._zustaende.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        gesamt = len(self._zustaende)
        for i, zustand in enumerate(self._zustaende, start=1):
            self.__dict__.update(zustand)
            beschriftung = f"Seite {i} von {gesamt}"
            if i == 1:
                text(self, INFO_X, Y_SEITENZAHL_S1, beschriftung, 8.0, farbe=GRAU_TEXT)
            else:
                text(self, SEITENZAHL_R, Y_SEITENZAHL_FOLGE, beschriftung, 8.0,
                     farbe=GRAU_TEXT, align="right")
            rl_canvas.Canvas.showPage(self)
        rl_canvas.Canvas.save(self)


class KuDDokument:

    def __init__(self, pfad, dokumentart="Angebot", belegnummer="",
                 empfaenger=None, kundennummer="", ansprechpartner="",
                 datum="", betreff="", ort=None, mwst=19.0,
                 verbandslogos=True):
        register_fonts()
        self.pfad = pfad
        self.dokumentart = dokumentart
        self.belegnummer = belegnummer
        self.empfaenger = empfaenger or []
        self.kundennummer = kundennummer
        self.ansprechpartner = ansprechpartner
        self.datum = datum
        self.betreff = betreff
        self.ort = ort or FIRMA["sitz"]
        self.mwst = mwst
        self.verbandslogos = verbandslogos

        self.c = _Blatt(pfad, pagesize=(SEITE_B, SEITE_H))
        self.c.setTitle(f"{dokumentart} {belegnummer}".strip())
        self.c.setAuthor(FIRMA["name"])

        self.seite = 1
        self.gruppen = []            # (Nr, Titel, Summe)
        self._gruppe = None          # laufende Hauptposition
        self._in_tabelle = False
        self.y = 0.0

        self._kopf_seite1()

    # ------------------------------------------------------------- Seiten
    def _kopf_seite1(self):
        c = self.c
        draw_logo(c)

        # Rücksendezeile mit den quadratischen Trennern
        x = 69.04
        for i, teil in enumerate(RUECKSENDE):
            if i:
                c.drawImage(TRENNER, x + 1.20, Y_RUECKSENDE + 0.37,
                            width=4.25, height=4.25, mask="auto")
                x += 1.20 + 4.25 + 1.60
            x += text(c, x, Y_RUECKSENDE, teil, 6.0, farbe=GRAU_TEXT)

        # Empfängeranschrift
        y = Y_ANSCHRIFT
        for zeile in self.empfaenger:
            text(c, LINKS, y, zeile, 10.0)
            y -= ZEILE

        self._absenderblock()
        self._fussblock()

        text(c, 69.95, Y_DOKUMENTART_S1, self.dokumentart, 12.0, fett=True)
        text(c, POS_X, Y_BELEG_S1, self.belegnummer, 10.0, fett=True)
        if self.betreff:
            text(c, LINKS, Y_BETREFF, self.betreff, 10.0)

        self.y = Y_ANREDE

    def _absenderblock(self):
        c = self.c
        g = GRAU_TEXT
        text(c, INFO_X, 693.28, FIRMA["name"], 8.0, fett=True, farbe=g)
        text(c, INFO_X, 684.55, FIRMA["zusatz"], 8.0, farbe=g)
        text(c, INFO_X, 665.37, FIRMA["strasse"], 8.0, farbe=g)
        text(c, INFO_X, 655.78, FIRMA["ort"], 8.0, farbe=g)
        text(c, INFO_X, 642.82, "Tel.:", 8.0, farbe=g)
        text(c, INFO_WERT_X, 642.82, FIRMA["telefon"], 8.0, farbe=g)
        text(c, INFO_X, 633.23, "Fax:", 8.0, farbe=g)
        text(c, INFO_WERT_X, 633.23, FIRMA["fax"], 8.0, farbe=g)
        text(c, INFO_X, 614.47, FIRMA["mail"], 8.0, farbe=g)
        text(c, INFO_X, 604.88, FIRMA["web"], 8.0, farbe=g)
        text(c, INFO_X, 584.58, f"Kundennummer: {self.kundennummer}".rstrip(), 8.0, farbe=g)
        text(c, INFO_X, 575.17, f"Ansprechpartner: {self.ansprechpartner}".rstrip(), 8.0, farbe=g)
        text(c, INFO_X, 556.62, f"{self.ort}, {self.datum}".rstrip(", "), 8.0, farbe=g)

    def _fussblock(self):
        c = self.c
        g = GRAU_TEXT
        zeilen = [f"Geschäftsführer: {FIRMA['geschaeftsfuehrer']}"]
        for name, iban, bic in BANKEN:
            zeilen += [name, f"IBAN: {iban}", f"BIC: {bic}"]
        zeilen += [f"Sitz: {FIRMA['sitz']}", FIRMA["register"],
                   f"USt-IdNr.: {FIRMA['ustid']}"]
        y = Y_FUSSBLOCK
        for z in zeilen:
            text(c, INFO_X, y, z, 8.0, farbe=g)
            y -= INFO_SCHRITT
        if self.verbandslogos:
            draw_verbandslogos(c)

    def neue_seite(self, mit_tabellenkopf=False):
        self.c.showPage()
        self.seite += 1
        c = self.c
        text(c, 69.95, Y_DOKUMENTART_FOLGE, self.dokumentart, 12.0, fett=True)
        text(c, 71.13, Y_BELEG_FOLGE, self.belegnummer, 10.0)
        if mit_tabellenkopf:
            self._tabellenkopf()
            self.y = Y_ERSTE_POSITION
        else:
            self.y = 738.70

    def _platz(self, hoehe):
        """Sorgt dafür, dass hoehe Punkte unter der aktuellen Grundlinie frei sind."""
        if self.y - hoehe < MIN_Y:
            self.neue_seite(mit_tabellenkopf=self._in_tabelle)
            return True
        return False

    # -------------------------------------------------------------- Textteil
    def anrede(self, s):
        text(self.c, LINKS, self.y, s, 10.0)
        self.y = Y_TEXT_S1 if self.seite == 1 else self.y - ABSATZ

    def absatz(self, s, x=LINKS, max_breite=None, groesse=10.0, fett=False,
               schritt=ZEILE, abstand=ABSATZ):
        max_breite = max_breite or (GES_R - x)
        for zeile in umbrechen(s, max_breite, groesse):
            self._platz(schritt)
            text(self.c, x, self.y, zeile, groesse, fett=fett)
            self.y -= schritt
        self.y -= (abstand - schritt)

    def vorbemerkung(self, absaetze, titel="Vorbemerkung:", x=TEXT_X):
        """Eingerückter Block wie im Referenzblatt: Titel, dann Absätze."""
        self.y = 405.56 if self.seite == 1 else self.y
        if titel:
            text(self.c, x, self.y, titel, 10.0)
            self.y -= ABSATZ
        for a in absaetze:
            self.absatz(a, x=x, max_breite=EINZUG_BREITE, schritt=ZEILE_EINZUG)

    def leerraum(self, hoehe):
        self.y -= hoehe

    # --------------------------------------------------------------- Tabelle
    def _tabellenkopf(self, spalten=None):
        c = self.c
        y = Y_TABELLENKOPF
        text(c, POS_X, y, "Position", 10.0)
        text(c, 154.68, y, "Leistungsbeschreibung", 10.0)
        text(c, 328.24, y, "Menge", 10.0)
        text(c, 397.19, y, "Einheitspreis (Euro)", 10.0)
        text(c, 485.45, y, "Gesamtbetrag (Euro)", 10.0)
        c.setStrokeColor(SCHWARZ)
        c.setLineWidth(0.75)
        c.line(TAB_L, Y_TABELLENLINIE, TAB_R, Y_TABELLENLINIE)

    def tabelle(self):
        """Beginnt den Positionsteil auf einer neuen Seite."""
        self._in_tabelle = True
        self.neue_seite(mit_tabellenkopf=True)

    def hauptposition(self, nr, titel, details=None):
        """Gliederungsebene 01, 02, 03 – fett, optional mit Detailzeilen."""
        if self._gruppe is not None:
            self.gruppensumme()
        self._platz(HAUPT_ZU_UNTER + ZEILE)
        text(self.c, POS_X, self.y, nr, 10.0, fett=True)
        text(self.c, TEXT_X, self.y, titel, 10.0, fett=True)
        self._gruppe = [nr, titel, 0.0]
        if details:
            for label, wert in details:
                self.y -= ZEILE
                self._platz(ZEILE)
                text(self.c, TEXT_X, self.y, label, 10.0, fett=True)
                text(self.c, DETAIL_WERT_X, self.y, wert, 10.0, fett=True)
            self.y -= HAUPT_ZU_UNTER
        else:
            self.y -= HAUPT_ZU_UNTER
        self._basis = self.y + HAUPT_ZU_UNTER

    def foto(self, pfad, kante=FOTO_KANTE):
        """Objektfoto in der Leistungsspalte, Standard 6 x 6 cm."""
        oberkante = getattr(self, "_basis", self.y) - FOTO_OBEN
        if oberkante - kante < MIN_Y:
            self.neue_seite(mit_tabellenkopf=True)
            oberkante = self.y - FOTO_OBEN
        self.c.drawImage(pfad, TEXT_X, oberkante - kante, width=kante, height=kante,
                         preserveAspectRatio=True, anchorAtXY=False, mask="auto")
        self.y = oberkante - kante - FOTO_UNTEN

    def position(self, nr, titel, beschreibung=None, menge=None, einheit="",
                 einzelpreis=None, gesamt=None):
        """Unterposition 01.01 – Titel, Beschreibungszeilen, Mengen- und Preiszeile."""
        beschreibung = beschreibung or []
        bedarf = ZEILE * (1 + len(beschreibung) + 1)
        self._platz(bedarf)
        text(self.c, POS_X, self.y, nr, 10.0)
        text(self.c, TEXT_X, self.y, titel, 10.0)
        for zeile in beschreibung:
            self.y -= ZEILE
            text(self.c, TEXT_X, self.y, zeile, 10.0)
        if menge is not None:
            if gesamt is None:
                gesamt = round(menge * (einzelpreis or 0.0), 2)
            self.y -= ZEILE
            text(self.c, MENGE_R, self.y, zahl(menge), 10.0, align="right")
            text(self.c, EINHEIT_X, self.y, einheit, 10.0)
            if einzelpreis is not None:
                text(self.c, EP_R, self.y, zahl(einzelpreis), 10.0, align="right")
            text(self.c, GES_R, self.y, zahl(gesamt), 10.0, align="right")
            if self._gruppe:
                self._gruppe[2] += gesamt
        self.y -= ZEILE

    def gruppensumme(self, nr=None, titel=None, betrag=None):
        """Summenzeile einer Hauptposition mit Linie darüber."""
        if self._gruppe is None and betrag is None:
            return
        nr = nr or self._gruppe[0]
        titel = titel or self._gruppe[1]
        betrag = self._gruppe[2] if betrag is None else betrag
        self._platz(MENGE_ZU_LINIE + LINIE_ZU_SUMME + ZEILE)
        y_linie = self.y + ZEILE - MENGE_ZU_LINIE
        c = self.c
        c.setStrokeColor(SCHWARZ)
        c.setLineWidth(0.75)
        c.line(SUM_L, y_linie, SUM_R, y_linie)
        y = y_linie - LINIE_ZU_SUMME
        text(c, POS_X, y, "Summe", 10.0, fett=True)
        text(c, 154.68, y, f"{nr} {titel}", 10.0, fett=True)
        text(c, SUMME_R, y, zahl(betrag), 10.0, fett=True, align="right")
        self.gruppen.append((nr, titel, betrag))
        self._gruppe = None
        self.y = y - SUMME_ZU_HAUPT

    # ------------------------------------------------------- Zusammenstellung
    def zusammenstellung(self, mwst=None, neue_seite=True):
        if self._gruppe is not None:
            self.gruppensumme()
        mwst = self.mwst if mwst is None else mwst
        if neue_seite:
            self._in_tabelle = False
            self.neue_seite()
        c = self.c
        y = 731.62 if neue_seite else self.y
        text(c, POS_X, y, "Zusammenstellung", 10.0, fett=True)
        c.setStrokeColor(SCHWARZ)
        c.setLineWidth(0.60)
        c.line(POS_X, y - 2.10, POS_X + breite("Zusammenstellung", 10.0), y - 2.10)

        y -= 14.75
        netto = 0.0
        for nr, titel, betrag in self.gruppen:
            text(c, POS_X, y, nr, 10.0, fett=True)
            text(c, 181.90, y, titel, 10.0, fett=True)
            text(c, ZUSAMMEN_R, y, zahl(betrag), 10.0, fett=True, align="right")
            netto += betrag
            y -= 14.755

        y += 14.755
        c.setLineWidth(0.75)
        c.line(470.89, y - 6.26, 560.47, y - 6.26)
        y -= 17.02
        text(c, POS_X, y, "Nettosumme", 10.0)
        text(c, ZUSAMMEN_R, y, zahl(netto), 10.0, align="right")

        steuer = round(netto * mwst / 100.0, 2)
        y -= 14.46
        text(c, POS_X, y, "MwSt.", 10.0)
        text(c, 450.78, y, zahl(mwst), 10.0, align="right")
        text(c, 455.46, y, "%", 10.0)
        text(c, ZUSAMMEN_R, y, zahl(steuer), 10.0, align="right")

        c.line(470.88, y - 6.25, 560.47, y - 6.25)
        y -= 17.01
        text(c, POS_X, y, f"Summe {self.dokumentart}", 10.0, fett=True)
        text(c, 509.55, y, "EUR", 10.0, fett=True)
        text(c, ZUSAMMEN_R, y, zahl(netto + steuer), 10.0, fett=True, align="right")
        c.line(470.88, y - 4.71, 560.47, y - 4.71)
        c.line(470.88, y - 6.96, 560.47, y - 6.96)

        self.brutto = netto + steuer
        self.netto = netto
        self.y = y - 46.78

    # ------------------------------------------------------------ Schlussteil
    def schluss(self, satz="Wir hoffen Ihnen ein interessantes Angebot unterbreitet zu haben und verbleiben",
                gruss="mit freundlichen Grüßen", unterzeichner="", firma=None,
                unterschrift=None):
        c = self.c
        firma = FIRMA["name"] if firma is None else firma
        if satz:
            self._platz(ABSATZ)
            text(c, LINKS, self.y, satz, 10.0)
            self.y -= ABSATZ
        text(c, LINKS, self.y, gruss, 10.0)
        y_gruss = self.y
        if unterschrift and os.path.exists(unterschrift):
            c.drawImage(unterschrift, LINKS, y_gruss - 58.08, width=144.62,
                        height=54.96, preserveAspectRatio=True, mask="auto")
        self.y = y_gruss - 74.80
        if unterzeichner:
            text(c, LINKS, self.y, unterzeichner, 10.0)
            self.y -= ZEILE
        if firma:
            text(c, LINKS, self.y, firma, 10.0)
            self.y -= ZEILE

    # --------------------------------------------------------- Auftragsblatt
    def auftragsformular(self):
        """Rücksendeformular, Seitenaufbau wie im Referenzblatt."""
        self._in_tabelle = False
        self.neue_seite()
        c = self.c
        strich = "_" * 85
        text(c, LINKS, 738.70, "Absender:", 10.0)
        y = 662.22
        for z in [FIRMA["name"], FIRMA["zusatz"], FIRMA["strasse"], FIRMA["ort"]]:
            text(c, LINKS, y, z, 10.0)
            y -= ZEILE

        text(c, LINKS, 569.16, "AUFTRAG", 14.0)
        text(c, LINKS, 557.40, "(Bitte ausfüllen und zurücksenden)", 8.0)
        text(c, LINKS, 532.39, strich, 10.0)
        text(c, LINKS, 519.64,
             f"Hiermit beauftragen wir Sie, die Arbeiten gemäß {self.dokumentart}-Nr. "
             "________________ vom ________________", 10.0)
        text(c, LINKS, 506.90, "auszuführen.", 10.0)

        kaesten = [(478.46, "alle Positionen"),
                   (461.96, "nur die Position Nr."),
                   (445.46, "ausschließlich _______________________________"),
                   (428.96, "Gesamtbrutto _______________________________")]
        for y, s in kaesten:
            self._kasten(y)
            text(c, 91.51, y, s, 10.0)

        text(c, 163.07, 461.96, "_" * 27, 10.0, schriftart="Helvetica")
        text(c, LINKS, 402.67, "Die Ausführung der Arbeiten wird gewünscht:", 10.0)
        kaesten2 = [(386.96, "nach Vereinbarung"),
                    (370.46, "Angabe der Telefonnummer: ____________________"),
                    (353.96, "am: ____________________"),
                    (337.46, "die entsprechende Genehmigung der Behörde "
                             "(Baumschutzverordnung), soweit notwendig, liegt vor.")]
        for y, s in kaesten2:
            self._kasten(y)
            text(c, 91.51, y, s, 10.0)

        text(c, LINKS, 323.92, strich, 10.0)
        text(c, LINKS, 298.43, "Auftraggeber:", 10.0)
        text(c, 284.03, 298.43, "Rechnungsempfänger:", 10.0)
        text(c, LINKS, 260.18, strich, 10.0)
        text(c, LINKS, 249.36, "Bitte den vollständigen Namen und Anschrift", 8.0, fett=True)
        text(c, 248.03, 249.36, "Ort/Datum", 8.0)
        text(c, 320.03, 249.36, "rechtsverbindl. Unterschrift", 8.0)
        text(c, LINKS, 239.01, "des Auftraggebers und Rechnungsempfängers", 8.0, fett=True)
        text(c, LINKS, 228.67, "nennen bzw. ergänzen.", 8.0, fett=True)

    def _kasten(self, y, x=69.12):
        """Ankreuzkästchen mit Schatten – entspricht dem Wingdings-Zeichen des Musters."""
        c = self.c
        b, h, versatz = 7.90, 10.00, 1.45
        c.setFillColor(SCHWARZ)
        c.rect(x + versatz, y + 0.55 - versatz, b, h, fill=1, stroke=0)
        c.setFillColor(WEISS)
        c.setStrokeColor(SCHWARZ)
        c.setLineWidth(0.72)
        c.rect(x, y + 0.55, b, h, fill=1, stroke=1)
        c.setFillColor(SCHWARZ)

    # ------------------------------------------------------ Widerrufsanhänge
    def widerrufsbelehrung(self):
        """Anhang A, Widerrufsformular und Verbrauchererklärung – drei Seiten."""
        self._in_tabelle = False
        adresse = [FIRMA["name"], FIRMA["zusatz"], None, FIRMA["strasse"],
                   FIRMA["ort"], None, f"Tel.: {FIRMA['telefon_intl']}",
                   f"Fax: {FIRMA['fax_intl']}", FIRMA["mail"], FIRMA["web"]]

        # ---- Seite: Anhang A
        self.neue_seite()
        c = self.c
        kopf = ["Anhang A: Widerrufsbelehrung bei außerhalb von Geschäftsräumen "
                "geschlossenen Verträgen und bei Fernabsatzverträgen mit",
                "Ausnahme von Verträgen über Finanzdienstleistungen"]
        y = 738.70
        for z in kopf:
            text(c, LINKS, y, z, 10.0, fett=True)
            c.setLineWidth(0.75)
            c.line(LINKS, y - 1.18, LINKS + breite(z, 10.0), y - 1.18)
            y -= ZEILE
        text(c, LINKS, 692.98, "Widerrufsrecht", 10.0, fett=True)
        for i, z in enumerate([
                "Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.",
                "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsschluss.",
                "Um Ihr Widerrufsrecht auszuüben, müssen Sie uns"]):
            text(c, LINKS, 665.23 - i * 12.75, z, 10.0)
        y = 614.23
        for z in adresse:
            if z is None:
                y -= 12.75
            else:
                text(c, 104.78, y, z, 10.0)
                y -= 12.75
        for i, z in enumerate([
                "mittels einer eindeutigen Erklärung (z.B. ein mit der Post versandter Brief, Telefax oder Email) über Ihren Entschluss, diesen",
                "Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht",
                "vorgeschrieben ist."]):
            text(c, LINKS, 473.98 - i * 27.75, z, 10.0)
        text(c, LINKS, 390.73, "Folgen des Widerrufs", 10.0, fett=True)
        folgen = [
            "Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der",
            "Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die",
            "von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem",
            "Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung",
            "verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen",
            "wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet."]
        for i, z in enumerate(folgen):
            text(c, LINKS, 362.98 - i * 12.75, z, 10.0)
        schluss = [
            "Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen",
            "angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des",
            "Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang",
            "der im Vertrag vorgesehenen Dienstleistungen entspricht."]
        for i, z in enumerate(schluss):
            text(c, LINKS, 271.48 - i * 12.75, z, 10.0)

        # ---- Seite: Widerrufsformular
        self.neue_seite()
        c = self.c
        text(c, LINKS, 738.70, "Widerrufsformular", 10.0, fett=True)
        c.setLineWidth(0.75)
        c.line(LINKS, 737.52, LINKS + breite("Widerrufsformular", 10.0), 737.52)
        text(c, LINKS, 690.70,
             "Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses "
             "Formular aus und senden Sie es zurück.", 10.0)
        y = 642.70
        for z in adresse:
            if z is None:
                y -= 12.75
            else:
                text(c, 104.78, y, z, 10.0)
                y -= 12.75
        text(c, LINKS, 474.70, "Hiermit widerrufe(n) ich/wir, _____________________________________,"
                               "den von mir/uns abgeschlossenen Vertrag", 10.0)
        text(c, LINKS, 461.95, "über die Erbringung der folgenden Dienstleistung.", 10.0)
        text(c, LINKS, 416.20, "Bestellt am ______________________________________ "
                               "/erhalten am ____________________________", 10.0)
        text(c, LINKS, 377.95, "Name des/der Verbraucher(s) ___________________________________", 10.0)
        text(c, LINKS, 339.72, "Anschrift des/der Verbraucher(s) ________________________________", 10.0)
        text(c, LINKS, 288.73, "________________________________", 10.0)
        text(c, 320.03, 288.73, "________________________________", 10.0)
        text(c, LINKS, 275.99, "(Ort / Datum)", 10.0)
        text(c, 320.03, 275.99, "(Ort / Datum)", 10.0)
        text(c, LINKS, 222.76, "________________________________", 10.0)
        text(c, 320.03, 222.76, "________________________________", 10.0)
        text(c, LINKS, 210.01, "(Unterschrift Auftragnehmer)", 10.0)
        text(c, 320.03, 210.01, "(Unterschrift Auftraggeber)", 10.0)

        # ---- Seite: Verbrauchererklärung
        self.neue_seite()
        c = self.c
        text(c, LINKS, 738.70,
             "Verbrauchererklärung über Beginn der Arbeiten vor Ablauf der Widerrufsfrist", 10.0,
             fett=True)
        text(c, LINKS, 700.47, "Hiermit bestätige ich _______________________________________", 10.0)
        text(c, 145.21, 687.73, "(Name des Verbrauchers)", 10.0)
        punkte = [
            (649.51, "1.", ["Dass ich darüber belehrt wurde, dass mir ein 14-tägiges Widerrufsrecht zusteht. Eine entsprechende",
                            "Widerrufsbelehrung und ein Muster-Widerrufsformular wurden mir ausgehändigt."]),
            (611.28, "2.", ["Dass ich ausdrücklich zustimme, dass die beauftragten Arbeiten vor Ablauf der Widerrufsfrist beginnen."]),
            (585.79, "3.", ["Dass ich darüber in Kenntnis gesetzt wurde, dass ich mein Widerrufsrecht bei vollständiger Vertragserfüllung",
                            "verliere."]),
            (547.57, "4.", ["Dass ich für den Fall, dass ich vor vollständiger Vertragserfüllung den Vertrag widerrufe, für die bis zum",
                            "Widerruf erbrachten Leistungen einen Wertersatz zu leisten habe."])]
        for y0, nr, zeilen in punkte:
            text(c, LINKS, y0, nr, 10.0)
            for i, z in enumerate(zeilen):
                text(c, 104.03, y0 - i * 12.74, z, 10.0)
        text(c, LINKS, 474.10, "_" * 81, 10.0)
        text(c, LINKS, 461.35, "Datum", 10.0)
        text(c, 217.50, 461.35, "Unterschrift des Verbrauchers", 10.0)

    # ------------------------------------------------------------- Speichern
    def speichern(self):
        """Schließt das Dokument ab und trägt die Seitenzahlen nach."""
        self.c.showPage()
        self.c.save()
        return self.pfad

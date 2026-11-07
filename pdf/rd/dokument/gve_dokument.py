# -*- coding: utf-8 -*-
"""
Blattgenerator Riedrich und Dremel GmbH (Gärtner von Eden).

Baut Angebot, Auftragsbestätigung, Rechnung, Aufmaß, Lieferschein, Protokoll
und Brief auf demselben Blatt. Sämtliche Maße stammen aus dem Referenzblatt
`references/Angebot-MUSTER-Referenz.pdf` (Angebot 26101-01-001, 29.05.2026)
und sind dort nachgemessen. Nullpunkt unten links, A4 hoch.

Kurzform:

    from gve_dokument import GvEDokument

    d = GvEDokument("Angebot.pdf", dokumentart="Angebot",
                    belegnummer="26101-01-001",
                    empfaenger=["Herr", "Christoph Dietrich",
                                "Meisenstraße 18", "14612 Falkensee"],
                    ansprechpartner="Thorsten Dremel", datum="29.05.2026",
                    betreff="BV: Meisenstraße 18, 14612 Falkensee - Gartenplanung")
    d.anrede("Sehr geehrter Herr Dietrich,")
    d.absatz("wir bedanken uns für die Anfrage …")
    d.vorbemerkung([...])
    d.tabelle()
    d.hauptposition("01", "Gartenplanung")
    d.position("01.01", "Gartenplanung bis 1000m2", bloecke=[...],
               menge=1.0, einheit="psch", einzelpreis=2521.01)
    d.gruppensumme()
    d.zusammenstellung()
    d.schluss(zahlung="Wir bitten um Vorkasse")
    d.auftragsformular()
    d.widerrufsbelehrung()
    d.speichern()

Die Bausteine nach `tabelle()` sind optional. Ein Brief besteht nur aus
`anrede()`, `absatz()` und `schluss()`; ein Lieferschein aus Tabelle ohne
Preise; eine Rechnung aus Tabelle, Zusammenstellung und Schluss ohne
Auftragsformular und ohne Widerrufsanhänge.
"""

import os

from reportlab.pdfgen import canvas as rl_canvas

from gve_cd import (SEITE_B, SEITE_H, SCHWARZ, WEISS, FIRMA, BANKEN, RUECKSENDE,
                    UNTERSCHRIFT, register_fonts, text, breite, umbrechen, zahl,
                    draw_signet, draw_fusslogos)

# ------------------------------------------------------------- Satzspiegel
LINKS = 68.03            # Fließtext, Anschrift, Betreff, Formulare
POS_X = 69.63            # Positionsnummer und Tabellenüberschriften
TEXT_X = 153.08          # Leistungsbeschreibung
KOPF_TEXT_X = 154.68     # Spaltenkopf und Summentitel
BULLET_X = 189.08        # Aufzählungen innerhalb einer Leistung
TEXT_R = 462.0           # rechte Kante der Leistungsspalte, dort bricht der Text um
TITEL_R = 318.0          # Umbruchkante, wenn Menge und Preis auf der Titelzeile stehen
MENGE_KOPF = 323.22
MENGE_R = 352.25         # Menge, rechtsbündig
EINHEIT_X = 355.68
EP_KOPF = 394.16
EP_R = 466.22            # Einheitspreis, rechtsbündig
GES_KOPF = 474.40
GES_R = 559.49           # Gesamtbetrag in der Positionszeile, rechtsbündig
SUMME_R = 559.35         # Gruppensumme, rechtsbündig
ZUSAMMEN_R = 559.21      # Zusammenstellung, rechtsbündig
MWST_SATZ_R = 461.68     # "19,00  %", rechtsbündig
TAB_L, TAB_R = 68.03, 561.61      # Linie unter dem Tabellenkopf
SUM_L, SUM_R = 471.02, 560.61     # Linie über einer Gruppensumme
ZUS_L, ZUS_R = 470.89, 560.47     # Linien in der Zusammenstellung
INFO_X = 445.83          # Kundennummer, Ansprechpartner, Seite, Ort/Datum
FUSS_X = 69.47           # Fußblock unten links
FUSS_SITZ_X = 219.47     # zweite Spalte der Anschriftenzeile im Fuß
SEITENZAHL_R = 574.21    # Seitenzahl der Folgeseiten, rechtsbündig
EINZUG_BREITE = 383.5    # Satzbreite des eingerückten Vorbemerkungsblocks

# -------------------------------------------------------------- Grundlinien
Y_RUECKSENDE = 695.38
Y_ANSCHRIFT = 680.05
Y_INFO = 549.12          # erste Zeile des Infoblocks rechts
Y_DOKUMENTART_S1 = 539.33
Y_BELEG_S1 = 526.15
Y_BETREFF = 498.09
Y_ANREDE = 455.47
Y_TEXT_S1 = 429.97
Y_VORBEMERKUNG_S1 = 376.72
Y_FUSSBLOCK = 85.11
Y_SEITENZAHL_FOLGE = 811.22
Y_DOKUMENTART_FOLGE = 779.73
Y_TEXT_FOLGE = 753.24
Y_TABELLENKOPF_NEU = 754.37   # Tabellenkopf auf einer frisch begonnenen Seite

# ------------------------------------------------------------------ Abstände
ZEILE = 12.75            # Grundschritt in Anschrift und Positionstabelle
ZEILE_FLIESS = 12.0      # Schritt innerhalb eines umbrochenen Absatzes
ABSATZ = 25.50           # Abstand zwischen zwei Absätzen
INFO_SCHRITT = 11.34     # Schritt im Infoblock rechts
FUSS_SCHRITT = 10.80     # Schritt im Fußblock
KOPF_ZU_LINIE = 8.87     # Tabellenkopf zur Trennlinie
KOPF_ZU_ZEILE = 22.39    # Tabellenkopf zur ersten Positionszeile
HAUPT_ZU_UNTER = 31.76   # Hauptposition zur ersten Unterposition
UNTER_ZU_TEXT = 25.50    # Unterposition zum ersten Beschreibungsblock
MENGE_ZU_LINIE = 9.44    # Mengenzeile zur Summenlinie
LINIE_ZU_SUMME = 10.40   # Summenlinie zur Summenzeile
SUMME_ZU_HAUPT = 19.85   # Gruppensumme zur nächsten Hauptposition
SUMME_ZU_ZUSAMMEN = 34.02  # Gruppensumme zur Überschrift Zusammenstellung
ZUS_SCHRITT = 14.755     # Schritt zwischen den Gruppenzeilen
FOTO_KANTE = 170.08      # 6 cm, Standardgröße eines Objektfotos
FOTO_OBEN = 5.94
FOTO_UNTEN = 39.72
MIN_Y_S1 = 121.79        # tiefste Grundlinie auf Seite 1 (darunter der Fußblock)
MIN_Y_FOLGE = 45.0       # tiefste Grundlinie auf den Folgeseiten


class _Blatt(rl_canvas.Canvas):
    """Canvas, der die Seitenzahl erst beim Speichern setzt.

    Vorher ist die Gesamtzahl der Seiten nicht bekannt, und im Kopf steht
    „Seite 1 von 7“ – nicht „Seite 1“.
    """

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
                text(self, INFO_X, Y_INFO - 2 * INFO_SCHRITT, beschriftung, 10.0)
            else:
                text(self, SEITENZAHL_R, Y_SEITENZAHL_FOLGE, beschriftung, 8.0,
                     align="right")
            rl_canvas.Canvas.showPage(self)
        rl_canvas.Canvas.save(self)


class GvEDokument:

    def __init__(self, pfad, dokumentart="Angebot", belegnummer="",
                 empfaenger=None, kundennummer="", ansprechpartner="",
                 datum="", betreff="", ort=None, mwst=19.0, fusslogos=True,
                 signet=None):
        register_fonts()
        self.pfad = pfad
        self.dokumentart = dokumentart
        self.belegnummer = belegnummer
        self.empfaenger = empfaenger or []
        self.kundennummer = kundennummer
        self.ansprechpartner = ansprechpartner
        self.datum = datum
        self.betreff = betreff
        self.ort = ort or FIRMA["absendeort"]
        self.mwst = mwst
        self.fusslogos = fusslogos
        self.signet = signet

        self.c = _Blatt(pfad, pagesize=(SEITE_B, SEITE_H))
        self.c.setTitle(f"{dokumentart} {belegnummer}".strip())
        self.c.setAuthor(FIRMA["name"])

        self.seite = 1
        self.gruppen = []       # (Nr, Titel, Summe)
        self._gruppe = None     # laufende Hauptposition
        self._in_tabelle = False
        self.netto = self.brutto = 0.0
        self.y = 0.0

        self._kopf_seite1()

    # ------------------------------------------------------------ Seitenkopf
    def _kopf_seite1(self):
        c = self.c
        draw_signet(c, self.signet)

        text(c, 69.20, Y_RUECKSENDE, RUECKSENDE, 7.0, fett=True)

        y = Y_ANSCHRIFT
        for zeile in self.empfaenger:
            text(c, LINKS, y, zeile, 10.0)
            y -= ZEILE

        self._infoblock()
        self._fussblock()

        text(c, 69.95, Y_DOKUMENTART_S1, self.dokumentart, 12.0, fett=True)
        if self.belegnummer:
            text(c, POS_X, Y_BELEG_S1, self.belegnummer, 10.0)
        if self.betreff:
            text(c, LINKS, Y_BETREFF, self.betreff, 10.0, fett=True)

        self.y = Y_ANREDE

    def _infoblock(self):
        """Kundennummer, Ansprechpartner, Seite, Ort und Datum – rechts oben.

        Die Seitenzeile bleibt frei: sie wird erst beim Speichern gefüllt,
        wenn die Gesamtzahl der Seiten feststeht.
        """
        c = self.c
        text(c, INFO_X, Y_INFO, f"Kundennummer: {self.kundennummer}".rstrip(), 10.0)
        text(c, INFO_X, Y_INFO - INFO_SCHRITT,
             f"Ansprechpartner: {self.ansprechpartner}".rstrip(), 10.0)
        text(c, INFO_X, Y_INFO - 3 * INFO_SCHRITT,
             f"{self.ort}, {self.datum}".rstrip(", "), 10.0)

    def _fussblock(self):
        c = self.c
        y = Y_FUSSBLOCK
        text(c, FUSS_X, y, f"{FIRMA['name']} {FIRMA['zusatz']} ·", 9.0)
        y -= FUSS_SCHRITT
        text(c, FUSS_X, y,
             f"Post: {FIRMA['post_strasse']} · {FIRMA['post_ort']}", 9.0)
        text(c, FUSS_SITZ_X, y, f"Sitz: {FIRMA['strasse']} · {FIRMA['ort']}", 9.0)
        y -= FUSS_SCHRITT
        text(c, FUSS_X, y,
             f"Telefon: {FIRMA['telefon']} · eMail: {FIRMA['mail']} · "
             f"web: {FIRMA['web']}", 9.0)
        for name, iban, bic in BANKEN:
            y -= FUSS_SCHRITT
            text(c, FUSS_X, y, f"{name} · IBAN {iban} · BIC {bic}", 9.0)
        y -= FUSS_SCHRITT
        text(c, FUSS_X, y, f"{FIRMA['register']} · Ust-IdNr. {FIRMA['ustid']}", 9.0)
        y -= FUSS_SCHRITT
        text(c, FUSS_X, y, f"Geschäftsführer: {FIRMA['geschaeftsfuehrer']}", 9.0)
        if self.fusslogos:
            draw_fusslogos(c)

    def neue_seite(self, mit_tabellenkopf=False):
        self.c.showPage()
        self.seite += 1
        text(self.c, 69.95, Y_DOKUMENTART_FOLGE, self.dokumentart, 12.0, fett=True)
        if mit_tabellenkopf:
            self._tabellenkopf(Y_TABELLENKOPF_NEU)
            self.y = Y_TABELLENKOPF_NEU - KOPF_ZU_ZEILE
        else:
            self.y = Y_TEXT_FOLGE

    @property
    def min_y(self):
        return MIN_Y_S1 if self.seite == 1 else MIN_Y_FOLGE

    def _platz(self, hoehe):
        """Sorgt dafür, dass `hoehe` Punkte unter der Grundlinie frei bleiben."""
        if self.y - hoehe < self.min_y:
            self.neue_seite(mit_tabellenkopf=self._in_tabelle)
            return True
        return False

    # -------------------------------------------------------------- Textteil
    def anrede(self, s):
        text(self.c, LINKS, self.y, s, 10.0)
        self.y = Y_TEXT_S1 if self.seite == 1 else self.y - ABSATZ

    def absatz(self, s, x=LINKS, max_breite=None, groesse=10.0, fett=False,
               schritt=ZEILE_FLIESS, abstand=ABSATZ):
        max_breite = max_breite or (GES_R - x)
        for zeile in umbrechen(s, max_breite, groesse):
            self._platz(0)
            text(self.c, x, self.y, zeile, groesse, fett=fett)
            self.y -= schritt
        self.y -= (abstand - schritt)

    def vorbemerkung(self, absaetze, titel="Vorbemerkungen", x=TEXT_X):
        """Eingerückter Block wie im Referenzblatt.

        Er beginnt auf Seite 1 immer auf derselben Grundlinie – der Abstand
        zum Anschreiben ist im Muster fest, nicht aus dem Text gerechnet.
        """
        if self.seite == 1:
            self.y = Y_VORBEMERKUNG_S1
        if titel:
            self._platz(ABSATZ)
            text(self.c, x, self.y, titel, 10.0)
            self.y -= ABSATZ
        for a in absaetze:
            self.absatz(a, x=x, max_breite=EINZUG_BREITE)

    def leerraum(self, hoehe):
        self.y -= hoehe

    # --------------------------------------------------------------- Tabelle
    def _tabellenkopf(self, y, preise=True):
        c = self.c
        text(c, POS_X, y, "Position", 10.0)
        text(c, KOPF_TEXT_X, y, "Leistungsbeschreibung", 10.0)
        text(c, MENGE_KOPF, y, "Menge", 10.0)
        if preise:
            text(c, EP_KOPF, y, "Einheitspreis (Euro)", 10.0)
            text(c, GES_KOPF, y, "Gesamtbetrag (Euro)", 10.0)
        c.setStrokeColor(SCHWARZ)
        c.setLineWidth(0.75)
        c.line(TAB_L, y - KOPF_ZU_LINIE, TAB_R, y - KOPF_ZU_LINIE)

    def tabelle(self, y=None, preise=True, neue_seite=False):
        """Beginnt den Positionsteil.

        Ohne Angaben läuft die Tabelle auf der laufenden Seite weiter, sobald
        genug Platz für Kopf und erste Zeile da ist – so steht sie auch im
        Referenzblatt, direkt unter den Vorbemerkungen. `y` setzt den Kopf auf
        eine feste Grundlinie, `neue_seite=True` erzwingt einen Umbruch.
        """
        self._in_tabelle = True
        self._preise = preise
        if neue_seite:
            self.neue_seite()
            y = Y_TABELLENKOPF_NEU
        if y is None:
            y = self.y
            if y - KOPF_ZU_ZEILE - ZEILE < self.min_y:
                self.neue_seite()
                y = Y_TABELLENKOPF_NEU
        self._tabellenkopf(y, preise=preise)
        self.y = y - KOPF_ZU_ZEILE

    def hauptposition(self, nr, titel):
        """Gliederungsebene 01, 02, 03 – fett, sammelt die Gruppensumme."""
        if self._gruppe is not None:
            self.gruppensumme()
        # Eine Hauptposition allein am Seitenfuß liest sich wie ein Fehler –
        # deshalb muss mindestens die erste Unterposition mit aufs Blatt.
        self._platz(HAUPT_ZU_UNTER + ZEILE * 2)
        text(self.c, POS_X, self.y, nr, 10.0, fett=True)
        text(self.c, TEXT_X, self.y, titel, 10.0, fett=True)
        self._gruppe = [nr, titel, 0.0]
        self._letzte = self.y
        self.y -= HAUPT_ZU_UNTER

    def position(self, nr, titel, bloecke=None, beschreibung=None, menge=None,
                 einheit="", einzelpreis=None, gesamt=None):
        """Unterposition 01.01.

        `bloecke` ist die Form aus dem Referenzblatt: eine Liste aus
        (Überschrift, [Aufzählungspunkte]). Die Überschrift steht auf der
        Textspalte, die Punkte eingerückt; zwischen zwei Blöcken liegt ein
        Absatz. Überschrift und Punkt dürfen jeweils auch eine Liste sein –
        dann steht jedes Element auf einer eigenen Zeile, ohne Umbruchlogik.
        Das braucht man, wenn ein Blatt zeichengenau nachgebaut werden soll.
        `beschreibung` bleibt für einfache Fälle: eine Liste roher Zeilen auf
        der Textspalte.
        """
        hat_text = bool(bloecke or beschreibung)
        self._platz(ZEILE * 2)
        text(self.c, POS_X, self.y, nr, 10.0)

        # Ohne Beschreibung teilen sich Titel, Menge und Preis eine Zeile – so
        # sieht eine schlichte Aufmaß- oder Lieferscheinzeile aus. Dann darf
        # der Titel nicht in die Mengenspalte laufen und wird davor umbrochen.
        grenze = (TITEL_R if (menge is not None and not hat_text) else TEXT_R)
        titelzeilen = umbrechen(titel, grenze - TEXT_X, 10.0)
        for i, z in enumerate(titelzeilen):
            if i:
                self.y -= ZEILE
                self._platz(0)
            text(self.c, TEXT_X, self.y, z, 10.0)
        self._letzte = self.y

        if hat_text:
            self.y -= UNTER_ZU_TEXT

        def zeilen_setzen(inhalt, x):
            zeilen = list(inhalt) if isinstance(inhalt, (list, tuple)) else \
                umbrechen(inhalt, TEXT_R - x, 10.0)
            for z in zeilen:
                self._platz(0)
                text(self.c, x, self.y, z, 10.0)
                self._letzte = self.y
                self.y -= ZEILE

        for zeile in (beschreibung or []):
            zeilen_setzen(zeile, TEXT_X)

        for i, (kopf, punkte) in enumerate(bloecke or []):
            if i:
                self.y -= (ABSATZ - ZEILE)
            if kopf:
                zeilen_setzen(kopf, TEXT_X)
            for punkt in punkte:
                zeilen_setzen(punkt, BULLET_X)

        if menge is not None:
            if gesamt is None:
                gesamt = round(menge * (einzelpreis or 0.0), 2)
            self._platz(0)
            text(self.c, MENGE_R, self.y, zahl(menge), 10.0, align="right")
            if einheit:
                text(self.c, EINHEIT_X, self.y, einheit, 10.0)
            if getattr(self, "_preise", True):
                if einzelpreis is not None:
                    text(self.c, EP_R, self.y, zahl(einzelpreis), 10.0, align="right")
                text(self.c, GES_R, self.y, zahl(gesamt), 10.0, fett=True, align="right")
            if self._gruppe:
                self._gruppe[2] += gesamt
            self._letzte = self.y
            self.y -= ZEILE

        # Abstand zur nächsten Unterposition: ein Absatz, wie zwischen zwei
        # Beschreibungsblöcken auch.
        self.y -= (ABSATZ - ZEILE)

    def foto(self, pfad, kante=FOTO_KANTE):
        """Objektfoto in der Leistungsspalte, Standard 6 × 6 cm."""
        oberkante = self.y - FOTO_OBEN
        if oberkante - kante < self.min_y:
            self.neue_seite(mit_tabellenkopf=self._in_tabelle)
            oberkante = self.y - FOTO_OBEN
        self.c.drawImage(pfad, TEXT_X, oberkante - kante, width=kante, height=kante,
                         preserveAspectRatio=True, anchorAtXY=False, mask="auto")
        self.y = oberkante - kante - FOTO_UNTEN

    def gruppensumme(self, nr=None, titel=None, betrag=None):
        """Summenzeile einer Hauptposition mit Linie darüber."""
        if self._gruppe is None and betrag is None:
            return
        nr = nr or self._gruppe[0]
        titel = titel or self._gruppe[1]
        betrag = self._gruppe[2] if betrag is None else betrag
        # Die Linie hängt an der letzten gesetzten Grundlinie der Gruppe,
        # nicht am freien Satzstand darunter.
        letzte = getattr(self, "_letzte", self.y)
        if letzte - MENGE_ZU_LINIE - LINIE_ZU_SUMME < self.min_y:
            self.neue_seite(mit_tabellenkopf=self._in_tabelle)
            letzte = self.y
        y_linie = letzte - MENGE_ZU_LINIE
        c = self.c
        c.setStrokeColor(SCHWARZ)
        c.setLineWidth(0.75)
        c.line(SUM_L, y_linie, SUM_R, y_linie)
        y = y_linie - LINIE_ZU_SUMME
        text(c, POS_X, y, "Summe", 10.0, fett=True)
        text(c, KOPF_TEXT_X, y, f"{nr} {titel}", 10.0, fett=True)
        text(c, SUMME_R, y, zahl(betrag), 10.0, fett=True, align="right")
        self.gruppen.append((nr, titel, betrag))
        self._gruppe = None
        self._letzte = y
        self.y = y - SUMME_ZU_HAUPT

    # ------------------------------------------------------- Zusammenstellung
    def zusammenstellung(self, mwst=None, neue_seite=False):
        """Gruppen, Nettosumme, Steuer und Endsumme.

        Im Referenzblatt folgt sie unmittelbar auf die letzte Gruppensumme,
        auf derselben Seite. Nur wenn kein Platz mehr ist, bricht sie um.
        """
        if self._gruppe is not None:
            self.gruppensumme()
        mwst = self.mwst if mwst is None else mwst
        self._in_tabelle = False
        bedarf = 60.0 + ZUS_SCHRITT * max(1, len(self.gruppen))
        if neue_seite:
            self.neue_seite()
            y = Y_TEXT_FOLGE
        else:
            y = self.y + SUMME_ZU_HAUPT - SUMME_ZU_ZUSAMMEN
            if y - bedarf < self.min_y:
                self.neue_seite()
                y = Y_TEXT_FOLGE

        c = self.c
        titel = "Zusammenstellung"
        text(c, POS_X, y, titel, 10.0, fett=True)
        c.setStrokeColor(SCHWARZ)
        c.setLineWidth(0.60)
        c.line(POS_X, y - 2.10, POS_X + breite(titel, 10.0), y - 2.10)

        y -= ZUS_SCHRITT
        netto = 0.0
        for i, (nr, gtitel, betrag) in enumerate(self.gruppen):
            if i:
                y -= ZUS_SCHRITT
            text(c, POS_X, y, nr, 10.0, fett=True)
            text(c, 181.90, y, gtitel, 10.0, fett=True)
            text(c, ZUSAMMEN_R, y, zahl(betrag), 10.0, fett=True, align="right")
            netto += betrag

        c.setLineWidth(0.75)
        c.line(ZUS_L, y - 6.62, ZUS_R, y - 6.62)
        y -= 6.62 + LINIE_ZU_SUMME
        text(c, POS_X, y, "Nettosumme", 10.0)
        text(c, ZUSAMMEN_R, y, zahl(netto), 10.0, align="right")

        steuer = round(netto * mwst / 100.0, 2)
        y -= 14.46
        text(c, POS_X, y, "MwSt.", 10.0)
        text(c, MWST_SATZ_R, y, f"{zahl(mwst)}  %", 10.0, align="right")
        text(c, ZUSAMMEN_R, y, zahl(steuer), 10.0, align="right")

        c.line(ZUS_L, y - 6.61, ZUS_R, y - 6.61)
        y -= 6.61 + LINIE_ZU_SUMME
        text(c, POS_X, y, f"Summe {self.dokumentart}", 10.0, fett=True)
        text(c, ZUSAMMEN_R, y, f"EUR {zahl(netto + steuer)}", 10.0, fett=True,
             align="right")
        c.line(ZUS_L - 0.01, y - 5.07, ZUS_R, y - 5.07)
        c.line(ZUS_L - 0.01, y - 7.32, ZUS_R, y - 7.32)

        self.netto, self.brutto = netto, netto + steuer
        self._hat_summe = True
        self.y = y

    # ------------------------------------------------------------ Schlussteil
    def schluss(self, zahlung=None,
                satz="Wir hoffen Ihnen ein interessantes Angebot unterbreitet zu haben und verbleiben",
                gruss="mit freundlichen Grüßen", unterzeichner=None, firma=None,
                unterschrift=UNTERSCHRIFT):
        """Zahlungshinweis, Schlusssatz, Grußformel, Unterschrift und Absender."""
        c = self.c
        unterzeichner = FIRMA["geschaeftsfuehrer"] if unterzeichner is None else unterzeichner
        firma = FIRMA["name"] if firma is None else firma

        # Nach einer Endsumme sitzt der Schlussteil tiefer als nach reinem
        # Fließtext – so steht es im Referenzblatt.
        self.y -= 39.69 if getattr(self, "_hat_summe", False) else ABSATZ
        if zahlung:
            self._platz(28.35)
            text(c, LINKS, self.y, zahlung, 10.0)
            self.y -= 28.35
        if satz:
            self._platz(ABSATZ)
            text(c, LINKS, self.y, satz, 10.0)
            self.y -= ABSATZ

        self._platz(75.0)
        y_gruss = self.y
        text(c, LINKS, y_gruss, gruss, 10.0)
        if unterschrift and os.path.exists(unterschrift):
            c.drawImage(unterschrift, LINKS, y_gruss - 3.48 - 42.48,
                        width=145.13, height=42.48, mask="auto")
        self.y = y_gruss - 62.32
        if unterzeichner:
            text(c, LINKS, self.y, unterzeichner, 10.0)
            self.y -= ZEILE
        if firma:
            text(c, LINKS, self.y, firma, 10.0)
            self.y -= ZEILE

    # --------------------------------------------------------- Auftragsblatt
    def auftragsformular(self):
        """Rücksendeformular auf eigener Seite, Aufbau wie im Referenzblatt."""
        self._in_tabelle = False
        self.neue_seite()
        c = self.c
        strich = "_" * 85

        text(c, LINKS, 753.24, "Absender:", 10.0)
        y = 676.74
        for z in [FIRMA["name"], FIRMA["zusatz"], FIRMA["strasse"], FIRMA["ort"]]:
            text(c, LINKS, y, z, 10.0)
            y -= ZEILE

        text(c, LINKS, 583.78, "AUFTRAG", 14.0)
        text(c, LINKS, 571.79, "(Bitte ausfüllen und zurücksenden)", 8.0)
        text(c, LINKS, 546.84, strich, 10.0)
        text(c, LINKS, 534.09,
             f"Hiermit beauftragen wir Sie, die Arbeiten gemäß {self.dokumentart}-Nr. "
             "________________ vom ________________", 10.0)
        text(c, LINKS, 521.34, "auszuführen.", 10.0)

        for y, x, s in [(492.52, 94.51, "alle Positionen"),
                        (476.02, 94.51, "nur die Position Nr. ___________________________"),
                        (459.52, 91.51, "ausschließlich _______________________________"),
                        (443.02, 91.51, "Gesamtbrutto _______________________________")]:
            self._kasten(y)
            text(c, x, y, s, 10.0)

        text(c, LINKS, 417.09, "Die Ausführung der Arbeiten wird gewünscht:", 10.0)
        for y, s in [(401.02, "nach Vereinbarung"),
                     (384.52, "Angabe der Telefonnummer: ____________________"),
                     (368.02, "am: ____________________")]:
            self._kasten(y)
            text(c, 83.56, y, s, 10.0)

        text(c, LINKS, 354.84, strich, 10.0)
        text(c, LINKS, 329.34, "Auftraggeber:", 10.0)
        text(c, 284.03, 329.34, "Rechnungsempfänger:", 10.0)
        text(c, LINKS, 291.09, strich, 10.0)
        text(c, LINKS, 280.19, "Bitte den vollständigen Namen und Anschrift", 8.0, fett=True)
        text(c, 284.03, 280.19, "Ort/Datum", 8.0)
        text(c, 356.03, 280.19, "rechtsverbindl. Unterschrift", 8.0)
        text(c, LINKS, 269.84, "des Auftraggebers und Rechnungsempfängers", 8.0, fett=True)
        text(c, LINKS, 259.49, "nennen bzw. ergänzen.", 8.0, fett=True)

    def _kasten(self, y, x=68.03):
        """Ankreuzkästchen mit Schlagschatten – das Wingdings-Zeichen des Musters."""
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
        """Anhang A, Widerrufsformular und Verbrauchererklärung – drei Seiten.

        Der Wortlaut folgt dem Referenzblatt. Er gehört an jedes Angebot an
        Verbraucher; bei Unternehmen, Behörden und Wohnungsunternehmen
        entfällt der Anhang.
        """
        self._in_tabelle = False
        adresse = [FIRMA["name"], FIRMA["zusatz"], None, FIRMA["strasse"],
                   FIRMA["ort"], None, f"Tel.: {FIRMA['telefon']}",
                   f"Fax: {FIRMA['fax']}", FIRMA["mail"], FIRMA["web"]]

        def adressblock(y0):
            y = y0
            for z in adresse:
                if z is None:
                    y -= ZEILE
                else:
                    text(self.c, 104.78, y, z, 10.0)
                    y -= ZEILE

        def unterstrichen(x, y, s, groesse=10.0):
            text(self.c, x, y, s, groesse, fett=True)
            self.c.setLineWidth(0.75)
            self.c.line(x, y - 1.37, x + breite(s, groesse), y - 1.37)

        # ---- Anhang A
        self.neue_seite()
        c = self.c
        unterstrichen(LINKS, 753.24,
                      "Anhang A: Widerrufsbelehrung bei außerhalb von Geschäftsräumen "
                      "geschlossenen Verträgen und bei")
        unterstrichen(LINKS, 741.24, "Fernabsatzverträgen mit")
        unterstrichen(LINKS, 728.49,
                      "Ausnahme von Verträgen über Finanzdienstleistungen")

        text(c, LINKS, 695.49, "Widerrufsrecht", 10.0, fett=True)
        for i, z in enumerate([
                "Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.",
                "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsschluss.",
                "Um Ihr Widerrufsrecht auszuüben, müssen Sie uns"]):
            text(c, LINKS, 667.74 - i * ZEILE, z, 10.0)
        adressblock(616.74)
        for i, z in enumerate([
                "mittels einer eindeutigen Erklärung (z.B. ein mit der Post versandter Brief, Telefax oder Email) über Ihren",
                "Entschluss, diesen"]):
            text(c, LINKS, 476.49 - i * ZEILE_FLIESS, z, 10.0)
        for i, z in enumerate([
                "Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das",
                "jedoch nicht"]):
            text(c, LINKS, 436.74 - i * ZEILE_FLIESS, z, 10.0)
        text(c, LINKS, 396.99, "vorgeschrieben ist.", 10.0)
        text(c, LINKS, 369.24, "Folgen des Widerrufs", 10.0, fett=True)
        folgen = [
            (341.49, ["Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben,",
                      "einschließlich der"]),
            (316.74, ["Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der",
                      "Lieferung als die"]),
            (291.99, ["von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn",
                      "Tagen ab dem"]),
            (267.24, ["Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese",
                      "Rückzahlung"]),
            (242.49, ["verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei",
                      "denn, mit Ihnen"]),
            (217.74, ["wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte",
                      "berechnet."]),
            (177.99, ["Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns",
                      "einen"]),
            (153.24, ["angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung",
                      "des"]),
            (128.49, ["Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum",
                      "Gesamtumfang"]),
            (103.74, ["der im Vertrag vorgesehenen Dienstleistungen entspricht."])]
        for y0, zeilen in folgen:
            for i, z in enumerate(zeilen):
                text(c, LINKS, y0 - i * ZEILE_FLIESS, z, 10.0)

        # ---- Widerrufsformular
        self.neue_seite()
        c = self.c
        unterstrichen(LINKS, 753.24, "Widerrufsformular")
        text(c, LINKS, 705.24,
             "Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses "
             "Formular aus und senden Sie es zurück.", 10.0)
        adressblock(657.24)
        text(c, LINKS, 489.24, "Hiermit widerrufe(n) ich/wir, "
             "_____________________________________,den von mir/uns abgeschlossenen", 10.0)
        text(c, LINKS, 477.24, "Vertrag", 10.0)
        text(c, LINKS, 464.49, "über die Erbringung der folgenden Dienstleistung.", 10.0)
        text(c, LINKS, 418.74, "Bestellt am ______________________________________ "
                               "/erhalten am ____________________________", 10.0)
        text(c, LINKS, 380.49, "Name des/der Verbraucher(s) ___________________________________", 10.0)
        text(c, LINKS, 342.24, "Anschrift des/der Verbraucher(s) ________________________________", 10.0)
        for y in (291.24, 225.24):
            text(c, LINKS, y, "_" * 32, 10.0)
            text(c, 320.03, y, "_" * 32, 10.0)
        text(c, LINKS, 278.49, "(Ort / Datum)", 10.0)
        text(c, 320.03, 278.49, "(Ort / Datum)", 10.0)
        text(c, LINKS, 212.49, "(Unterschrift Auftragnehmer)", 10.0)
        text(c, 356.03, 212.49, "(Unterschrift Auftraggeber)", 10.0)

        # ---- Verbrauchererklärung
        self.neue_seite()
        c = self.c
        text(c, LINKS, 753.24,
             "Verbrauchererklärung über Beginn der Arbeiten vor Ablauf der Widerrufsfrist",
             10.0, fett=True)
        text(c, LINKS, 714.99, "Hiermit bestätige ich _______________________________________", 10.0)
        text(c, 159.77, 702.24, "(Name des Verbrauchers)", 10.0)
        punkte = [
            (663.99, "1.", ["Dass ich darüber belehrt wurde, dass mir ein 14-tägiges Widerrufsrecht zusteht. Eine entsprechende",
                            "Widerrufsbelehrung und ein Muster-Widerrufsformular wurden mir ausgehändigt."]),
            (625.74, "2.", ["Dass ich ausdrücklich zustimme, dass die beauftragten Arbeiten vor Ablauf der Widerrufsfrist beginnen."]),
            (600.24, "3.", ["Dass ich darüber in Kenntnis gesetzt wurde, dass ich mein Widerrufsrecht bei vollständiger",
                            "Vertragserfüllung", "verliere."]),
            (549.99, "4.", ["Dass ich für den Fall, dass ich vor vollständiger Vertragserfüllung den Vertrag widerrufe, für die bis zum",
                            "Widerruf erbrachten Leistungen einen Wertersatz zu leisten habe."])]
        for y0, nr, zeilen in punkte:
            text(c, LINKS, y0, nr, 10.0)
            y = y0
            for i, z in enumerate(zeilen):
                # die zweite Zeile von Punkt 3 hängt im Muster am linken Rand
                x = LINKS if (nr == "3." and i == 1) else 104.03
                schritt = ZEILE_FLIESS if (nr == "3." and i == 1) else ZEILE
                text(c, x, y, z, 10.0)
                y -= schritt
        text(c, LINKS, 476.49, "_" * 81, 10.0)
        text(c, LINKS, 463.74, "Datum", 10.0)
        text(c, 245.56, 463.74, "Unterschrift des Verbrauchers", 10.0)

    # ------------------------------------------------------------- Speichern
    def speichern(self):
        """Schließt das Dokument ab und trägt die Seitenzahlen nach."""
        self.c.showPage()
        self.c.save()
        return self.pfad

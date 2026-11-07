# -*- coding: utf-8 -*-
"""
Grundmodul der Geschäftsdokumente von Riedrich und Dremel GmbH
(Gärtner von Eden, Werder/Havel).

Hier stehen Firmendaten, Farben, Schriftregistrierung und das Zeichnen von
Signet und Beiwerk. Alle Maße in Punkt, Nullpunkt unten links, A4 hoch
595,28 × 841,89 pt.

Referenzblatt: `references/Angebot-MUSTER-Referenz.pdf` (Angebot 26101-01-001
vom 29.05.2026). Jede Zahl in diesem Modul ist dort nachgemessen.
"""

import os

from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HIER = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.dirname(HIER)          # …/assets

# ---------------------------------------------------------------- Blattmaße
SEITE_B = 595.28
SEITE_H = 841.89

# ------------------------------------------------------------------- Farben
# Das Blatt kennt nur Schwarz. Eden-Grün und Berry sind die Akzentfarben der
# Marke (Schmuckschrift, grafische Elemente) und haben im Geschäftsdokument
# nichts zu suchen – sie stehen hier nur für Beilagen und Sonderdrucksachen.
SCHWARZ = Color(0, 0, 0)
WEISS = Color(1, 1, 1)
EDEN_GRUEN = HexColor("#7DBA3B")
BERRY = HexColor("#CF3D73")

# ------------------------------------------------------------------ Schrift
# Hausschrift laut CD: Neue Helvetica LT Std 35 Thin, ausschließlich Schwarz.
# Einen Fettschnitt setzt das Muster nicht ein – Fettes entsteht über Kontur
# (Textmodus 2, Strichstärke 0,34 pt). Deshalb gibt es hier nur einen Schnitt.
SCHRIFT = "HelveticaNeueLTStd-Thin"
SCHRIFT_DATEI = os.path.join(HIER, "HelveticaNeueLTStd-Thin.ttf")
FETT_KONTUR = 0.34

_registriert = False


def register_fonts():
    """Hausschrift registrieren. Mehrfachaufruf ist unschädlich.

    Fehlt die Schriftdatei, fällt alles auf Helvetica zurück. Das Blatt bleibt
    benutzbar, die Zeilen laufen aber anders um – deshalb die Warnung.
    """
    global _registriert, SCHRIFT
    if _registriert:
        return
    if os.path.exists(SCHRIFT_DATEI):
        pdfmetrics.registerFont(TTFont(SCHRIFT, SCHRIFT_DATEI))
    else:
        import warnings
        warnings.warn("Hausschrift fehlt – es wird Helvetica gesetzt.")
        SCHRIFT = "Helvetica"
    _registriert = True


# --------------------------------------------------------------- Firmendaten
FIRMA = {
    "name": "Riedrich und Dremel GmbH",
    "zusatz": "Garten- und Landschaftsbau",
    "post_strasse": "Am Markt 11b",
    "post_ort": "14542 Werder",
    "strasse": "Döberitzer Straße 51",
    "ort": "14612 Falkensee",
    "telefon": "+49 3322 4267242",
    "fax": "+49 3322 4267243",
    "mail": "info@riedrich-dremel.de",
    "web": "www.riedrich-dremel.de",
    "datenschutz": "www.riedrich-dremel.de/datenschutz",
    "geschaeftsfuehrer": "Thorsten Dremel",
    "register": "Amtsgericht Potsdam HRB 27 777 P",
    "ustid": "DE298938482",
    "absendeort": "Werder",          # steht vor dem Datum im Kopf
    "claim": "Mein Garten. Mein Zuhause.",
}

BANKEN = [
    ("Oberbank AG", "DE04 7012 0700 1891 1019 15", "OBKLDEMX"),
    ("Berliner Volksbank", "DE69 1009 0000 2623 6480 04", "BEVODEBB"),
]

# Rücksendezeile über dem Anschriftenfeld
RUECKSENDE = (f"{FIRMA['name']} · {FIRMA['post_strasse']} · {FIRMA['post_ort']}")

# ------------------------------------------------------------------- Assets
SIGNET = os.path.join(ASSETS, "betrieb",
                      "EDE_Signet_Gaertner_Riedrich_und_Dremel_rgb_Schrift_schwarz_transparent.png")
SIGNET_VERBUND = os.path.join(ASSETS, "verbund", "gve_signet_farbe_transparent.png")
LOGO_FGL = os.path.join(HIER, "FGL_Experten.png")
LOGO_AUSBILDUNG = os.path.join(HIER, "Ausbildungsbetrieb_GrueneBerufe.png")
UNTERSCHRIFT = os.path.join(HIER, "Unterschrift_Thorsten_Dremel.png")

# Lage des Signets im Referenzblatt, gemessen an der sichtbaren Zeichnung:
# linke Kante 411,91 · Oberkante 803,38 · Zeichnungshöhe 104,71.
# Die freigegebene PNG trägt rechts einen transparenten Rand, deshalb wird über
# das Seitenverhältnis der Datei skaliert und nicht über eine feste Breite.
SIGNET_X = 411.91
SIGNET_OBEN = 803.38
SIGNET_HOEHE = 104.71


# --------------------------------------------------------------- Textausgabe
def text(c, x, y, s, groesse=10.0, fett=False, farbe=SCHWARZ, align="left",
         schriftart=None):
    """Eine Zeile setzen; y ist die Grundlinie. Gibt die Satzbreite zurück.

    `fett` zeichnet die Kontur mit, weil die Hausschrift keinen Fettschnitt
    hat. Genau so arbeitet auch das Referenzblatt.
    """
    register_fonts()
    schriftart = schriftart or SCHRIFT
    b = pdfmetrics.stringWidth(s, schriftart, groesse)
    if align == "right":
        x -= b
    elif align == "center":
        x -= b / 2.0
    t = c.beginText()
    t.setTextOrigin(x, y)
    t.setFont(schriftart, groesse)
    t.setFillColor(farbe)
    if fett:
        t.setStrokeColor(farbe)
        c.setLineWidth(FETT_KONTUR)
        t.setTextRenderMode(2)
    t.textOut(s)
    if fett:
        t.setTextRenderMode(0)
    c.drawText(t)
    return b


def breite(s, groesse=10.0, schriftart=None):
    register_fonts()
    return pdfmetrics.stringWidth(s, schriftart or SCHRIFT, groesse)


def umbrechen(s, max_breite, groesse=10.0):
    """Fließtext auf eine Spaltenbreite umbrechen, Zeilenliste zurückgeben."""
    register_fonts()
    zeilen, zeile = [], ""
    for wort in s.split():
        probe = (zeile + " " + wort).strip()
        if breite(probe, groesse) <= max_breite or not zeile:
            zeile = probe
        else:
            zeilen.append(zeile)
            zeile = wort
    if zeile:
        zeilen.append(zeile)
    return zeilen


# ------------------------------------------------------------------- Zahlen
def zahl(wert, nachkomma=2):
    """Deutsche Schreibweise: 2.521,01"""
    s = f"{wert:,.{nachkomma}f}"
    return s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


# ------------------------------------------------------------------- Signet
def draw_signet(c, pfad=None, x=SIGNET_X, oben=SIGNET_OBEN, hoehe=SIGNET_HOEHE):
    """Signet oben rechts, Lage und Größe wie im Referenzblatt.

    Das Signet steht laut CD immer auf Weiß und wird nie nachgebaut oder
    umgefärbt – deshalb kommt hier ausschließlich eine freigegebene Datei aus
    `assets/` zum Zug.
    """
    from reportlab.lib.utils import ImageReader
    pfad = pfad or SIGNET
    bild = ImageReader(pfad)
    bb, bh = bild.getSize()
    b = hoehe * bb / float(bh)
    c.drawImage(bild, x, oben - hoehe, width=b, height=hoehe, mask="auto")
    return b


def draw_fusslogos(c):
    """Verbands- und Auszeichnungslogos unten rechts, Lage wie im Referenzblatt."""
    c.drawImage(LOGO_AUSBILDUNG, 415.32, 8.40, width=92.14, height=63.79, mask="auto")
    c.drawImage(LOGO_FGL, 514.54, 15.49, width=49.61, height=42.53, mask="auto")

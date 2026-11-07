# -*- coding: utf-8 -*-
"""
Corporate Design Kusche und Dremel GmbH – Grundmodul.

Enthält Firmendaten, Farben, Schriftregistrierung und das Zeichnen von Logo
und Beiwerk. Alle Maße in Punkt, Nullpunkt unten links, A4 hoch.

Referenzdokument: "Angebot MUSTER.pdf" (FastReport, 20.08.2026).
"""

import os
from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HIER = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- Blattmaße
SEITE_B = 595.28
SEITE_H = 841.89

# ------------------------------------------------------------------- Farben
BRAUN = HexColor("#764400")      # Logo-Signet und Claim, Pantone 161 C
GRAU_LOGO = HexColor("#939598")  # Logo-Wortmarke, Pantone Cool Gray 7 C
GRAU_TEXT = Color(0.569, 0.569, 0.569)   # Nebentexte im Dokument, ~#919191
SCHWARZ = Color(0, 0, 0)
WEISS = Color(1, 1, 1)

# ------------------------------------------------------------------ Schrift
SCHRIFT = "Swiss721BT-LightCondensed"
SCHRIFT_KURSIV = "Swiss721BT-LightCondensedItalic"
_registriert = False


def register_fonts():
    """Hausschrift registrieren. Mehrfachaufruf ist unschädlich."""
    global _registriert
    if _registriert:
        return
    pdfmetrics.registerFont(TTFont(SCHRIFT, os.path.join(HIER, "Swiss721BT-LightCondensed.ttf")))
    kursiv = os.path.join(HIER, "Swiss721BT-LightCondensedItalic.ttf")
    if os.path.exists(kursiv):
        pdfmetrics.registerFont(TTFont(SCHRIFT_KURSIV, kursiv))
    _registriert = True


# --------------------------------------------------------------- Firmendaten
FIRMA = {
    "name": "Kusche und Dremel GmbH",
    "zusatz": "Baumdienst",
    "strasse": "Döberitzer Straße 51",
    "ort": "14612 Falkensee",
    "telefon": "03322 422 23 83",
    "telefon_intl": "+49 3322 4222383",
    "fax": "03322 422 23 84",
    "fax_intl": "+49 3322 4222384",
    "mail": "info@kusche-dremel.de",
    "web": "www.kusche-dremel.de",
    "datenschutz": "www.kusche-dremel.de/datenschutz",
    "geschaeftsfuehrer": "Thorsten Dremel",
    "sitz": "Falkensee",
    "register": "Amtsgericht Potsdam HRB 27 776 P",
    "ustid": "DE298938474",
    "claim": "BAUM IN FORM",
}

BANKEN = [
    ("Oberbank AG", "DE79 7012 0700 1891 1019 23", "OBKLDEMX"),
    ("Berliner Volksbank", "DE82 1009 0000 2623 6530 08", "BEVODEBB"),
]

# Rücksendezeile über dem Anschriftenfeld
RUECKSENDE = [FIRMA["name"], FIRMA["strasse"], FIRMA["ort"]]

# ------------------------------------------------------------------- Assets
LOGO = os.path.join(HIER, "KuD_Logo.png")           # Wort-Bild-Marke, transparent
LOGO_WEB = os.path.join(HIER, "KuD_Logo_web.png")   # kleine Rasterfassung
TRENNER = os.path.join(HIER, "KuD_Trenner.png")     # Quadrat-Trenner der Rücksendezeile
LOGO_FGL = os.path.join(HIER, "FGL_Experten.png")   # "Die Experten für Garten & Landschaft"
LOGO_QBB = os.path.join(HIER, "QBB.png")            # Qualitätsgemeinschaft Baumpflege

LOGO_AR = 1.8711   # Seitenverhältnis der freigestellten Wort-Bild-Marke


# --------------------------------------------------------------- Textausgabe
def text(c, x, y, s, groesse=10.0, fett=False, farbe=SCHWARZ, align="left",
         schriftart=None):
    """Eine Zeile setzen. y ist die Grundlinie.

    Fett gibt es in dieser Schrift nicht als eigenen Schnitt – das Muster
    zeichnet Fettes über Kontur (Textmodus 2, Strichstärke 0,38 pt).
    """
    register_fonts()
    schriftart = schriftart or SCHRIFT
    breite = pdfmetrics.stringWidth(s, schriftart, groesse)
    if align == "right":
        x = x - breite
    elif align == "center":
        x = x - breite / 2.0
    t = c.beginText()
    t.setTextOrigin(x, y)
    t.setFont(schriftart, groesse)
    t.setFillColor(farbe)
    if fett:
        t.setStrokeColor(farbe)
        c.setLineWidth(0.38)
        t.setTextRenderMode(2)
    t.textOut(s)
    if fett:
        t.setTextRenderMode(0)
    c.drawText(t)
    return breite


def breite(s, groesse=10.0):
    register_fonts()
    return pdfmetrics.stringWidth(s, SCHRIFT, groesse)


def umbrechen(s, max_breite, groesse=10.0):
    """Fließtext auf eine Spaltenbreite umbrechen. Gibt eine Zeilenliste zurück."""
    register_fonts()
    zeilen, zeile = [], ""
    for wort in s.split():
        probe = (zeile + " " + wort).strip()
        if pdfmetrics.stringWidth(probe, SCHRIFT, groesse) <= max_breite or not zeile:
            zeile = probe
        else:
            zeilen.append(zeile)
            zeile = wort
    if zeile:
        zeilen.append(zeile)
    return zeilen


# ------------------------------------------------------------------- Zahlen
def zahl(wert, nachkomma=2):
    """Deutsche Schreibweise: 1.305,55"""
    s = f"{wert:,.{nachkomma}f}"
    return s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


# --------------------------------------------------------------------- Logo
def draw_logo(c, rechts=532.10, oben=793.44, logo_breite=106.74):
    """Wort-Bild-Marke oben rechts, Maße wie im Referenzblatt."""
    h = logo_breite / LOGO_AR
    c.drawImage(LOGO, rechts - logo_breite, oben - h, width=logo_breite, height=h,
                mask="auto")


def draw_verbandslogos(c):
    """Fußlogos unten links: FGL-Signet und QBB, Lage wie im Referenzblatt."""
    c.drawImage(LOGO_FGL, 60.94, 28.24, width=49.61, height=42.53, mask="auto")
    c.drawImage(LOGO_QBB, 124.73, 21.16, width=141.75, height=35.44, mask="auto")

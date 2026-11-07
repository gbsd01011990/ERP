# -*- coding: utf-8 -*-
"""Gemeinsame CD-Basis GBSD GmbH: Farben, Schriften, Wortmarke (nach Original-Logo)."""
import math
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ---- Farben (Tannengrün und Blattgrün aus dem Original-Logo ausgelesen) ----
TANNE     = HexColor("#1B5E20")   # Logo-Hintergrund, Primärfarbe
BLATTHELL = HexColor("#8BC34A")   # Logo-Blatt, Akzentfarbe
WALD      = HexColor("#2E7D32")   # Sekundärgrün für Buttons/Links
SAND      = HexColor("#F4F2EA")   # Naturweiß, warme Flächen
ANTHRAZIT = HexColor("#263238")   # Textfarbe
STEIN     = HexColor("#78909C")   # Grau, Nebentexte
WEISS     = HexColor("#FFFFFF")
MAI = BLATTHELL  # Rückwärtskompatibel: heller Akzent = Logo-Blattgrün

FARBEN = [
    ("Tannengrün",  "#1B5E20", "27 · 94 · 32",   "71 · 0 · 66 · 63", "Primärfarbe aus dem Logo: Flächen, Überschriften"),
    ("Blattgrün",   "#8BC34A", "139 · 195 · 74", "29 · 0 · 62 · 24", "Akzentfarbe aus dem Logo-Blatt: Highlights, Linien"),
    ("Waldgrün",    "#2E7D32", "46 · 125 · 50",  "63 · 0 · 60 · 51", "Sekundär: Buttons, Links, Zwischenzeilen"),
    ("Naturweiß",   "#F4F2EA", "244 · 242 · 234","0 · 1 · 4 · 4",    "Warme Hintergrundflächen, Infoboxen"),
    ("Anthrazit",   "#263238", "38 · 50 · 56",   "32 · 11 · 0 · 78", "Fließtext, Kontrastelemente"),
    ("Steingrau",   "#78909C", "120 · 144 · 156","23 · 8 · 0 · 39",  "Nebentexte, Linien, Bildunterschriften"),
]

# ---- Schriften ----
def register_fonts():
    base = "/usr/share/fonts/truetype/liberation/"
    pdfmetrics.registerFont(TTFont("LSans",   base + "LiberationSans-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("LSans-B", base + "LiberationSans-Bold.ttf"))
    pdfmetrics.registerFont(TTFont("LSans-I", base + "LiberationSans-Italic.ttf"))

# ---- Bildmarke: G mit Blatt im gerundeten Quadrat (Nachbau des Website-Logos) ----
def _blatt(c, cx, cy, l, rot_deg, color):
    """Kleines Blatt mit Spitzen an beiden Enden, Länge l, um rot_deg gedreht."""
    c.saveState()
    c.translate(cx, cy)
    c.rotate(rot_deg)
    p = c.beginPath()
    p.moveTo(-l / 2, 0)
    p.curveTo(-l * 0.15, l * 0.42, l * 0.15, l * 0.42, l / 2, 0)
    p.curveTo(l * 0.15, -l * 0.42, -l * 0.15, -l * 0.42, -l / 2, 0)
    p.close()
    c.setFillColor(color)
    c.drawPath(p, stroke=0, fill=1)
    c.restoreState()

def draw_bildmarke(c, x, y, s, fg=TANNE, g=WEISS, leaf=BLATTHELL):
    """Bildmarke nach Original: (x, y) = linke untere Ecke, s = Kantenlänge."""
    c.saveState()
    c.setFillColor(fg)
    c.roundRect(x, y, s, s, s * 0.22, stroke=0, fill=1)
    cx, cy = x + s * 0.47, y + s * 0.47      # G leicht nach unten links, Blatt bekommt Raum
    r = s * 0.26                             # Radius der G-Mittellinie
    t = s * 0.105                            # Strichstärke
    c.setStrokeColor(g)
    c.setLineWidth(t)
    c.setLineCap(0)                          # butt
    p = c.beginPath()
    p.arc(cx - r, cy - r, cx + r, cy + r, startAng=58, extent=302)  # Öffnung oben rechts
    c.drawPath(p, stroke=1, fill=0)
    c.line(cx, cy, cx + r + t / 2, cy)       # G-Balken bis zur Außenkante
    # Blatt in der Öffnung oben rechts
    bx = cx + r * 1.18 * math.cos(math.radians(52))
    by = cy + r * 1.18 * math.sin(math.radians(52))
    _blatt(c, bx, by, s * 0.17, 40, leaf)
    c.restoreState()

def draw_wortmarke(c, x, y, h, color=TANNE, sub=STEIN, mit_bildmarke=True, mit_sub=True, leaf=None):
    """Wort-Bild-Marke. (x, y) = linke Grundlinie der Wortmarke, h = Versalhöhe der Wortmarke in pt."""
    c.saveState()
    size = h / 0.72  # Fontgröße aus Versalhöhe (Liberation Sans capheight ~0.72)
    tx = x
    if mit_bildmarke:
        s = h * 1.35
        lf = leaf if leaf is not None else BLATTHELL
        if color == WEISS:
            draw_bildmarke(c, x, y - h * 0.18, s, fg=WEISS, g=TANNE, leaf=lf)
        else:
            draw_bildmarke(c, x, y - h * 0.18, s, fg=color, g=WEISS, leaf=lf)
        tx = x + s + h * 0.35
    c.setFillColor(color)
    c.setFont("LSans-B", size)
    c.drawString(tx, y, "GBSD")
    if mit_sub:
        c.setFillColor(sub)
        c.setFont("LSans", size * 0.245)
        c.drawString(tx + 1, y - size * 0.32, "GARTEN- & LANDSCHAFTSBAU · BAUMPFLEGE")
    c.restoreState()

# ---- Firmendaten ----
FIRMA = {
    "name": "GBSD GmbH",
    "strasse": "Am Markt 11b",
    "ort": "14542 Werder (Havel)",
    "tel": "03327 7407716",
    "mobil": "0156 78374913",
    "mail": "info@gbsd-werder.de",
    "web": "www.gbsd-werder.de",
    "gf": "Thorsten Dremel",
    "register": "Amtsgericht Potsdam · HRB 40586 P",
    "ustid": "USt-IdNr. DE400005532",
    "claim": "Ihr grüner Vollpartner für Berlin, Potsdam & Brandenburg",
    "bank": "Berliner Volksbank",
    "iban": "IBAN DE20 1009 0000 8001 0180 01",
    "bic": "BIC BEVODEBB",
}

BLATT = WALD  # Alias für bestehende Skripte

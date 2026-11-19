#!/usr/bin/env python3
"""
Zusatzquelle: Vergabeplattform des Landes Berlin. (Aus dem Repository ausschreibungs-radar übernommen.)

Berlin veroeffentlicht seine Bekanntmachungen als RSS-Feed. Dort stehen auch
unterschwellige Vergaben (UVgO, VOB/A), die im Datenservice des Bundes fehlen -
genau das Segment, in dem der Betrieb hauptsaechlich anbietet.

Feed: https://www.berlin.de/vergabeplattform/veroeffentlichungen/bekanntmachungen/feed.rss
"""

import hashlib
import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime

FEED_URL = "https://www.berlin.de/vergabeplattform/veroeffentlichungen/bekanntmachungen/feed.rss"


def _feld(text, name):
    treffer = re.search(rf"{name}:\s*(.+?)(?:<br>|$)", text, re.S)
    return treffer.group(1).strip() if treffer else ""


def hole_berlin(hole_funktion, log=print):
    """Liefert Eintraege im selben Format wie der Bundes-Export.

    hole_funktion(url, accept) -> bytes  (wird aus radar.py hereingereicht,
    damit SSL-Kontext und User-Agent identisch bleiben).
    """
    try:
        rohdaten = hole_funktion(FEED_URL, "application/rss+xml")
        baum = ET.fromstring(rohdaten)
    except Exception as fehler:
        log(f"  Berlin-Feed nicht erreichbar: {fehler}")
        return {}

    eintraege = {}
    for item in baum.findall(".//item"):
        titel = html.unescape((item.findtext("title") or "").strip())
        link = (item.findtext("link") or "").strip()
        text = html.unescape(item.findtext("description") or "")
        if not titel:
            continue

        # Kennung aus der tenderId des Portallinks, sonst aus der guid.
        tender = re.search(r"tenderId/(\d+)", link)
        # Stabile Kennung: Pythons hash() aendert sich mit jedem Programmstart (Hash-Randomisierung),
        # dieselbe Ausschreibung bekaeme sonst jeden Tag eine neue Kennung.
        kennung = f"berlin-{tender.group(1)}" if tender else "berlin-" + hashlib.sha1((titel + link).encode("utf-8")).hexdigest()[:12]

        ort_roh = _feld(text, "Ausführungsort")
        plz = ""
        ort = ort_roh
        plz_treffer = re.match(r"(\d{5})\s*,?\s*(.*)", ort_roh)
        if plz_treffer:
            plz, ort = plz_treffer.group(1), plz_treffer.group(2).strip()

        frist_datum = frist_zeit = ""
        frist_roh = _feld(text, "Eröffnungstermin")
        frist_treffer = re.match(r"(\d{2})\.(\d{2})\.(\d{4}),?\s*(\d{2}:\d{2})?", frist_roh)
        if frist_treffer:
            tag, monat, jahr, uhrzeit = frist_treffer.groups()
            frist_datum = f"{jahr}-{monat}-{tag}"
            frist_zeit = uhrzeit or ""

        veroeffentlicht = ""
        online = _feld(text, "Online seit")
        online_treffer = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", online)
        if online_treffer:
            tag, monat, jahr = online_treffer.groups()
            veroeffentlicht = f"{jahr}-{monat}-{tag}"

        eintraege[kennung] = {
            "kennung": kennung,
            "version": "01",
            "formtyp": "competition",
            "art": _feld(text, "Verfahrensart"),
            "veroeffentlicht": veroeffentlicht,
            "titel": titel,
            "beschreibung": "",
            "wert": "",
            "waehrung": "",
            "cpv": set(),
            "orte": {ort} if ort else set(),
            "plz": {plz} if plz else set(),
            "nuts": {"DE3"},          # Der Feed enthaelt ausschliesslich Berliner Vergaben.
            "auftraggeber": "",
            "auftraggeber_ort": ort,
            "auftragsart": "",
            "quelle": "Vergabeplattform Berlin",
            "portal_link": link,
            "frist_datum": frist_datum,
            "frist_zeit": frist_zeit,
        }

    # Der Feed listet einzelne Verfahren gelegentlich mehrfach.
    gesehen = {}
    eindeutig = {}
    for kennung, eintrag in eintraege.items():
        schluessel = (normalisiere(eintrag["titel"]), ",".join(sorted(eintrag["plz"])))
        if schluessel in gesehen:
            continue
        gesehen[schluessel] = kennung
        eindeutig[kennung] = eintrag

    entfernt = len(eintraege) - len(eindeutig)
    log(f"  Vergabeplattform Berlin: {len(eindeutig)} Bekanntmachungen im Feed"
        + (f" ({entfernt} Dublette(n) zusammengefasst)" if entfernt else ""))
    return eindeutig


def normalisiere(titel):
    """Fuer den Abgleich mit den Bundesdaten: Titel auf Kernbuchstaben reduzieren."""
    return re.sub(r"[^a-zäöüß0-9]", "", titel.lower())[:60]

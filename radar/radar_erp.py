#!/usr/bin/env python3
"""
Ausschreibungs-Radar im ERP.

Uebernommen aus dem Repository ausschreibungs-radar (radar.py, quelle_berlin.py):
Tagesexport des Datenservice Oeffentlicher Einkauf des Bundes (oeffentlichevergabe.de,
Open Data, CC0) und RSS-Feed der Vergabeplattform Berlin. Nur Standardbibliothek.

Neu gegenueber dem Original: mehrere Profile (je Firma eines) in einem Lauf, Ausgabe
als JSON fuer das ERP statt Markdown, Basis-URLs fuer Tests ueberschreibbar.

    python3 radar_erp.py < {"tage": ["2026-11-18"], "profile": [{"id": "...", "config": {...}}], "bekannt": ["kennung", ...]}

Ausgabe: {"tage_geladen": n, "berlin": n, "treffer": [{..., "profile": [{"id", "punkte", "gruende"}]}], "log": [...]}
"""

import csv
import html
import io
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import quelle_berlin  # noqa: E402

BASIS_URL = os.environ.get("RADAR_BUND_URL", "https://oeffentlichevergabe.de").rstrip("/")
EXPORT_URL = BASIS_URL + "/api/notice-exports?pubDay={tag}"
EXPORT_ACCEPT = "application/vnd.bekanntmachungsservice.csv.zip+zip"
DETAIL_URL = BASIS_URL + "/api/notices/{kennung}"
ANSICHT_URL = "https://oeffentlichevergabe.de/ui/de/bekanntmachung/{kennung}"
USER_AGENT = "Ausschreibungs-Radar/2.0 (ERP GBSD, Riedrich und Dremel, Kusche und Dremel)"
if os.environ.get("RADAR_BERLIN_URL"):
    quelle_berlin.FEED_URL = os.environ["RADAR_BERLIN_URL"]

SSL_KONTEXT = ssl.create_default_context()
RELEVANTE_FORMTYPEN = {"competition", "planning"}
PROTOKOLL = []


def log(text):
    PROTOKOLL.append(f"[{datetime.now():%H:%M:%S}] {text}")
    print(PROTOKOLL[-1], file=sys.stderr, flush=True)


def hole(url, accept, timeout=60, versuche=3):
    """Abruf mit Wiederholung.

    Der Datenservice des Bundes antwortet Rechenzentrums-Adressen (etwa denen
    von GitHub) zeitweise gar nicht. Ein einzelner Fehlversuch darf den Lauf
    deshalb nicht beenden.
    """
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT})
    letzter_fehler = None
    for versuch in range(1, versuche + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_KONTEXT) as antwort:
                return antwort.read()
        except urllib.error.HTTPError:
            raise                     # echte Antwort des Servers - weiterreichen
        except Exception as fehler:   # Zeitüberschreitung, Netzfehler
            letzter_fehler = fehler
            if versuch < versuche:
                log(f"  Versuch {versuch} fehlgeschlagen ({fehler}) — neuer Versuch")
                time.sleep(5 * versuch)
    raise letzter_fehler


def lade_tag(tag):
    """Tagesexport als dict {csv-name: [zeilen]}. None, wenn es fuer den Tag nichts gibt."""
    url = EXPORT_URL.format(tag=tag.isoformat())
    try:
        rohdaten = hole(url, EXPORT_ACCEPT)
    except urllib.error.HTTPError as fehler:
        if fehler.code in (400, 404):
            log(f"  {tag}: kein Export vorhanden (HTTP {fehler.code})")
            return None
        log(f"  {tag}: Server meldet HTTP {fehler.code} — Tag übersprungen")
        return None
    except Exception as fehler:
        log(f"  {tag}: nicht abrufbar ({fehler}) — Tag übersprungen")
        return None
    tabellen = {}
    with zipfile.ZipFile(io.BytesIO(rohdaten)) as archiv:
        for name in archiv.namelist():
            if not name.endswith(".csv"):
                continue
            with archiv.open(name) as datei:
                text = io.TextIOWrapper(datei, encoding="utf-8-sig", newline="")
                tabellen[name[:-4]] = list(csv.DictReader(text))
    return tabellen


def sammle_bekanntmachungen(tabellen):
    """Baut je Bekanntmachung einen Datensatz aus den Einzeltabellen."""
    eintraege = {}
    for zeile in tabellen.get("notice", []):
        kennung = zeile["noticeIdentifier"]
        eintraege[kennung] = {
            "kennung": kennung,
            "version": zeile.get("noticeVersion", ""),
            "formtyp": zeile.get("formType", ""),
            "art": zeile.get("noticeType", ""),
            "veroeffentlicht": zeile.get("publicationDate", "")[:10],
            "titel": "",
            "beschreibung": "",
            "wert": "",
            "waehrung": "",
            "cpv": set(),
            "orte": set(),
            "plz": set(),
            "nuts": set(),
            "auftraggeber": "",
            "auftraggeber_ort": "",
            "auftragsart": "",
        }

    for zeile in tabellen.get("purpose", []):
        eintrag = eintraege.get(zeile["noticeIdentifier"])
        if not eintrag:
            continue
        titel = html.unescape((zeile.get("title") or "").strip())
        beschreibung = html.unescape((zeile.get("description") or "").strip())
        # Die Zeile ohne lotIdentifier ist die Ebene des Gesamtauftrags.
        if titel and (not eintrag["titel"] or not zeile.get("lotIdentifier")):
            eintrag["titel"] = titel
        if beschreibung and len(beschreibung) > len(eintrag["beschreibung"]):
            eintrag["beschreibung"] = beschreibung
        if zeile.get("mainNature") and not eintrag["auftragsart"]:
            eintrag["auftragsart"] = zeile["mainNature"].strip()
        if zeile.get("estimatedValue") and not eintrag["wert"]:
            eintrag["wert"] = zeile["estimatedValue"]
            eintrag["waehrung"] = zeile.get("estimatedValueCurrency", "")

    for zeile in tabellen.get("classification", []):
        eintrag = eintraege.get(zeile["noticeIdentifier"])
        if not eintrag:
            continue
        for code in [zeile.get("mainClassificationCode", "")] + (
            zeile.get("additionalClassificationCodes", "") or ""
        ).split():
            if code.strip():
                eintrag["cpv"].add(code.strip())

    for zeile in tabellen.get("placeOfPerformance", []):
        eintrag = eintraege.get(zeile["noticeIdentifier"])
        if not eintrag:
            continue
        if zeile.get("placePerformanceCity"):
            eintrag["orte"].add(zeile["placePerformanceCity"].strip())
        if zeile.get("placePerformancePostCode"):
            eintrag["plz"].add(zeile["placePerformancePostCode"].strip())
        if zeile.get("placePerformanceCountrySubdivision"):
            eintrag["nuts"].add(zeile["placePerformanceCountrySubdivision"].strip())

    for zeile in tabellen.get("organisation", []):
        eintrag = eintraege.get(zeile["noticeIdentifier"])
        if not eintrag or "buyer" not in (zeile.get("organisationRole") or ""):
            continue
        if not eintrag["auftraggeber"]:
            eintrag["auftraggeber"] = (zeile.get("organisationName") or "").strip()
            eintrag["auftraggeber_ort"] = (zeile.get("organisationCity") or "").strip()
        # Ohne Leistungsort dient der Sitz des Auftraggebers als Ersatzsignal.
        if not eintrag["nuts"] and zeile.get("organisationCountrySubdivision"):
            eintrag["nuts"].add(zeile["organisationCountrySubdivision"].strip())
        if not eintrag["plz"] and zeile.get("organisationPostCode"):
            eintrag["plz"].add(zeile["organisationPostCode"].strip())

    return eintraege


def in_region(eintrag, config):
    nuts_praefixe = tuple(config["region_nuts"])
    plz_praefixe = tuple(config["region_plz"])
    if any(n.startswith(nuts_praefixe) for n in eintrag["nuts"]):
        return True
    return any(p.startswith(plz_praefixe) for p in eintrag["plz"])


def bewerte(eintrag, config):
    """Punktzahl + Begruendung. 0 Punkte = kein Thema fuer uns."""
    punkte = 0
    gruende = []

    cpv_praefixe = tuple(config["cpv_praefixe"])
    passende_cpv = sorted(c for c in eintrag["cpv"] if c.startswith(cpv_praefixe))
    if passende_cpv:
        punkte += config["score_cpv"]
        gruende.append("CPV " + ", ".join(passende_cpv))

    titel = eintrag["titel"].lower()
    beschreibung = eintrag["beschreibung"].lower()
    treffer_titel = [k for k in config["keywords"] if k in titel]
    treffer_text = [k for k in config["keywords"] if k in beschreibung and k not in treffer_titel]
    if treffer_titel:
        punkte += config["score_keyword_titel"]
        gruende.append("Titel: " + ", ".join(treffer_titel[:4]))
    if treffer_text:
        punkte += config["score_keyword_beschreibung"]
        gruende.append("Text: " + ", ".join(treffer_text[:4]))

    return punkte, gruende


def lokaler_tag(element):
    return element.tag.split("}")[-1]


def hole_details(kennung):
    """Frist, Portal-Link und Verfahrensart aus der eForms-Bekanntmachung.

    Das OCDS-Format liefert fuer deutsche Bekanntmachungen keine Angebotsfrist,
    das eForms-XML dagegen schon (TenderSubmissionDeadlinePeriod).
    Fehler beim Detailabruf duerfen den Lauf nicht kippen.
    """
    try:
        rohdaten = hole(DETAIL_URL.format(kennung=kennung) + "?format=eforms", "application/xml", timeout=45)
        baum = ET.fromstring(rohdaten)
    except Exception as fehler:
        log(f"  Detailabruf {kennung} fehlgeschlagen: {fehler}")
        return {}

    fristen = []
    for knoten in baum.iter():
        if lokaler_tag(knoten) != "TenderSubmissionDeadlinePeriod":
            continue
        datum = zeit = ""
        for kind in knoten:
            if lokaler_tag(kind) == "EndDate":
                datum = (kind.text or "")[:10]
            elif lokaler_tag(kind) == "EndTime":
                zeit = (kind.text or "")[:5]
        if datum:
            fristen.append((datum, zeit))

    portale = []
    for knoten in baum.iter():
        if lokaler_tag(knoten) == "URI" and knoten.text and knoten.text.startswith("http"):
            portale.append(knoten.text.strip())

    verfahren = ""
    for knoten in baum.iter():
        if lokaler_tag(knoten) == "ProcedureCode" and knoten.text:
            verfahren = knoten.text.strip()
            break

    fristen.sort()
    return {
        "frist_datum": fristen[0][0] if fristen else "",
        "frist_zeit": fristen[0][1] if fristen else "",
        "portal": portale[0] if portale else "",
        "verfahren": verfahren,
    }


def vorfilter(eintrag, config):
    """Region, Verfahrensart, Auftragsart und Ausschlusswoerter eines Profils."""
    if eintrag["formtyp"] not in RELEVANTE_FORMTYPEN:
        return False
    if eintrag["auftragsart"] not in config["erlaubte_auftragsarten"]:
        return False
    if not in_region(eintrag, config):
        return False
    titel_klein = eintrag["titel"].lower()
    return not any(a in titel_klein for a in config["ausschluss_titel"])


def main():
    auftrag = json.load(sys.stdin)
    profile = auftrag["profile"]
    bekannt = set(auftrag.get("bekannt", []))
    kandidaten = {}
    tage_geladen = 0

    def pruefen(kennung, eintrag):
        for p in profile:
            c = p["config"]
            if not vorfilter(eintrag, c):
                continue
            punkte, gruende = bewerte(eintrag, c)
            if punkte >= c["mindest_score"]:
                kandidaten.setdefault(kennung, eintrag).setdefault("profile", []).append({"id": p["id"], "punkte": punkte, "gruende": gruende})

    for tag in auftrag["tage"]:
        tabellen = lade_tag(date.fromisoformat(tag))
        if not tabellen:
            continue
        tage_geladen += 1
        eintraege = sammle_bekanntmachungen(tabellen)
        log(f"  {tag}: {len(eintraege)} Bekanntmachungen")
        for kennung, eintrag in eintraege.items():
            pruefen(kennung, eintrag)

    berlin = quelle_berlin.hole_berlin(lambda url, accept: hole(url, accept), log) if auftrag.get("berlin", True) else {}
    bekannte_titel = {quelle_berlin.normalisiere(e["titel"]) for e in kandidaten.values()}
    for kennung, eintrag in berlin.items():
        if quelle_berlin.normalisiere(eintrag["titel"]) in bekannte_titel:
            continue  # steht bereits ueber den Bundes-Datenservice im Bestand
        pruefen(kennung, eintrag)

    treffer = []
    for kennung, e in kandidaten.items():
        if e.get("quelle"):
            details = {"frist_datum": e.get("frist_datum", ""), "frist_zeit": e.get("frist_zeit", ""), "portal": e.get("portal_link", ""), "verfahren": e.get("art", "")}
        elif kennung in bekannt:
            details = {}  # schon im ERP: keinen zweiten Detailabruf
        else:
            details = hole_details(kennung)
        treffer.append({
            "kennung": kennung, "quelle": e.get("quelle", "Datenservice des Bundes"), "titel": e["titel"],
            "beschreibung": e["beschreibung"][:4000], "auftraggeber": e["auftraggeber"],
            "ort": ", ".join(sorted(e["orte"])) or e["auftraggeber_ort"], "plz": ", ".join(sorted(e["plz"])),
            "auftragsart": e["auftragsart"], "wert": e["wert"], "waehrung": e["waehrung"], "cpv": sorted(e["cpv"]),
            "veroeffentlicht": e.get("veroeffentlicht", ""), "frist_datum": details.get("frist_datum", ""),
            "frist_zeit": details.get("frist_zeit", ""), "portal": details.get("portal", ""), "verfahren": details.get("verfahren", ""),
            "bekanntmachung": "" if e.get("quelle") else ANSICHT_URL.format(kennung=kennung),
            "profile": e["profile"],
        })
    log(f"{len(treffer)} relevante Bekanntmachungen")
    json.dump({"tage_geladen": tage_geladen, "berlin": len(berlin), "treffer": treffer, "log": PROTOKOLL}, sys.stdout, ensure_ascii=False)
    return 0 if (tage_geladen or berlin or not auftrag["tage"]) else 2


if __name__ == "__main__":
    sys.exit(main())

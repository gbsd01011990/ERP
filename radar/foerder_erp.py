#!/usr/bin/env python3
"""
Foerdermittel-Radar im ERP: Foerderprogramme aus der Foerderdatenbank des Bundes
(foerderdatenbank.de, betrieben vom BMWE; enthaelt Bund, Laender und EU).

Zwei Betriebsarten, beide lesen JSON von stdin und schreiben JSON nach stdout:

  abruf     Liste aller Programme je Foerdergebiet (bundesweit, Berlin, Brandenburg) abrufen,
            Einzelseiten nur fuer Kandidaten laden (neu oder aelter als 30 Tage).
            Eingabe:  {"modus": "abruf", "regionen": [...], "profile": [{"id", "config"}],
                       "aktuell": [url, ...], "details_max": 120, "pause": 1.5}
            Ausgabe:  {"programme": [{url, titel, berechtigte, bereiche, gebiete, detail?}],
                       "vollstaendig": [region, ...], "log": [...]}

  bewerten  Programme (aus der ERP-Datenbank) gegen die Profile der Firmen pruefen, ohne Netz.
            Eingabe:  {"modus": "bewerten", "profile": [...], "programme": [{url, titel, kurztext, volltext,
                       berechtigte, bereiche, gebiete}]}
            Ausgabe:  {"ergebnisse": [{"url", "profile": [{"id", "punkte", "zielgruppen", "gruende"}]}]}

Die Seite schuetzt sich mit einer Bot-Abwehr. Deshalb: wenige Anfragen, Pause zwischen
den Abrufen, Einzelseiten nur fuer passende Programme. Nur Standardbibliothek.
"""

import html
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

BASIS = os.environ.get("FOERDER_URL", "https://www.foerderdatenbank.de").rstrip("/") + "/"
LISTE = BASIS + "SiteGlobals/FDB/Forms/Suche/Foederprogrammsuche_Formular.html?cl2Processes_Foerdergebiet={region}&filterCategories=FundingProgram"
USER_AGENT = "Foerdermittel-Radar/1.0 (ERP GBSD, Riedrich und Dremel, Kusche und Dremel)"
SSL_KONTEXT = ssl.create_default_context()
PROTOKOLL = []
MAX_SEITEN = 200

# Kuerzel der Filter -> Anzeigenamen (einige Seiten liefern die Kuerzel statt der Namen)
KUERZEL = {
    "aus_weiterbildung": "Aus- & Weiterbildung", "energieeffizienz_erneuerbare_energien": "Energieeffizienz & Erneuerbare Energien",
    "umwelt_naturschutz": "Umwelt- & Naturschutz", "staedtebau_stadterneuerung": "Städtebau & Stadterneuerung",
    "landwirtschaft_laendliche_entwicklung": "Landwirtschaft & Ländliche Entwicklung", "wohnungsbau_modernisierung": "Wohnungsbau & Modernisierung",
    "existenzgruendung_festigung": "Existenzgründung & -festigung", "unternehmensfinanzierung": "Unternehmensfinanzierung",
    "digitalisierung": "Digitalisierung", "mobilitaet": "Mobilität", "beratung": "Beratung", "infrastruktur": "Infrastruktur",
    "arbeit": "Arbeit", "regionalfoerderung": "Regionalförderung", "smart_cities_regionen": "Smart Cities & Regionen",
    "kultur_medien_sport": "Kultur, Medien & Sport", "gesundheit_soziales": "Gesundheit & Soziales",
    "_bundesweit": "bundesweit", "berlin": "Berlin", "brandenburg": "Brandenburg",
    "forschung_innovation_themenoffen": "Forschung & Innovation (themenoffen)", "forschung_innovation_themenspezifisch": "Forschung & Innovation (themenspezifisch)",
    "frauenfoerderung": "Frauenförderung", "messen_ausstellungen": "Messen & Ausstellungen", "aussenwirtschaft": "Außenwirtschaft", "corona": "Corona-Hilfe",
    "bildungseinrichtung": "Bildungseinrichtung", "forschungseinrichtung": "Forschungseinrichtung", "hochschule": "Hochschule",
    "existenzgruenderin": "Existenzgründer/in", "kommune": "Kommune", "oeffentliche_einrichtung": "Öffentliche Einrichtung",
    "privatperson": "Privatperson", "unternehmen": "Unternehmen", "verband_vereinigung": "Verband/Vereinigung",
    "zuschuss": "Zuschuss", "darlehen": "Darlehen", "buergschaft": "Bürgschaft", "beteiligung": "Beteiligung", "garantie": "Garantie", "sonstige": "Sonstige",
}
MIT_KOMMA = {"Kultur, Medien & Sport"}


def log(text):
    PROTOKOLL.append(f"[{datetime.now():%H:%M:%S}] {text}")
    print(PROTOKOLL[-1], file=sys.stderr, flush=True)


class Abwehr(Exception):
    """Die Bot-Abwehr hat statt der Seite eine Pruefseite geliefert."""


def hole(url, versuche=3, pause=1.5):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html", "Accept-Language": "de"})
    letzter = None
    for versuch in range(1, versuche + 1):
        try:
            with urllib.request.urlopen(req, timeout=45, context=SSL_KONTEXT) as antwort:
                ziel = antwort.geturl()
                text = antwort.read().decode("utf-8", "replace")
            if "perfdrive" in urllib.parse.urlparse(ziel).netloc or ("<h1" not in text and "card--fundingprogram" not in text and "hits--count" not in text):
                raise Abwehr(ziel)
            return text
        except urllib.error.HTTPError as fehler:
            if fehler.code in (404, 410):
                raise
            letzter = fehler
        except Exception as fehler:  # Netz, Zeitueberschreitung, Abwehr
            letzter = fehler
        if versuch < versuche:
            time.sleep(pause * 10 * versuch)
    raise letzter


# ------------------------------------------------------------------ HTML

def text_aus(fragment):
    """HTML-Ausschnitt als lesbarer Text mit Absaetzen."""
    s = re.sub(r"(?is)<(script|style|svg).*?</\1>", "", fragment)
    s = re.sub(r"(?i)<li[^>]*>", "\n• ", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</h[1-6]>|</li>|</div>|</ul>", "\n", s)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    zeilen = [re.sub(r"[ \t\xa0]+", " ", z).strip() for z in s.split("\n")]
    s = "\n".join(zeilen)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def liste_aus(text):
    teile = [t.strip() for t in html.unescape(text).strip().split(",")]
    teile = [t for t in teile if t]
    zusammen, i = [], 0
    while i < len(teile):
        if i + 1 < len(teile) and ", ".join(teile[i:i + 2]) in MIT_KOMMA:
            zusammen.append(", ".join(teile[i:i + 2])); i += 2; continue
        zusammen.append(KUERZEL.get(teile[i], teile[i])); i += 1
    return zusammen


def liste_lesen(seite, region):
    """Karten einer Ergebnisseite und Link zur naechsten Seite."""
    programme = []
    for karte in re.findall(r'(?s)<div class="card card--horizontal card--fundingprogram">(.*?)</dl>', seite):
        m = re.search(r'(?s)<p class="card--title">\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', karte)
        if not m:
            continue
        url = urllib.parse.urljoin(BASIS, html.unescape(m.group(1))).split("?")[0].split("#")[0]
        felder = dict((text_aus(k).rstrip(":?").strip().rstrip(":?"), v) for k, v in re.findall(r"(?s)<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", karte))
        programme.append({
            "url": url, "titel": text_aus(m.group(2)), "gebiete": [KUERZEL.get(region, region)],
            "berechtigte": liste_aus(text_aus(felder.get("Wer wird gefördert", ""))),
            "bereiche": liste_aus(text_aus(felder.get("Was wird gefördert", ""))),
        })
    weiter = re.search(r'<a[^>]*class="forward button"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*class="forward button"', seite)
    naechste = urllib.parse.urljoin(BASIS, html.unescape(weiter.group(1) or weiter.group(2))) if weiter else None
    anzahl = re.search(r'id="hits--count">\s*(\d+)', seite)
    return programme, naechste, int(anzahl.group(1)) if anzahl else None


def detail_lesen(seite):
    """Einzelseite eines Programms: Stammdaten (dt/dd), Kurztext, Volltext, Zusatzinfos."""
    d = {}
    m = re.search(r'(?s)<h1 class="title">(.*?)</h1>', seite)
    d["titel"] = text_aus(m.group(1)) if m else ""
    kopf = re.search(r'(?s)<dl class="grid-modul--two-elements document-info-fundingprogram">(.*?)</dl>', seite)
    for dt, dd in re.findall(r"(?s)<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", kopf.group(1) if kopf else ""):
        name = text_aus(dt).rstrip(":").strip()
        name = {"Foerderart": "Förderart", "Foerderbereich": "Förderbereich", "Foerdergebiet": "Fördergebiet",
                "Foerderberechtigte": "Förderberechtigte", "Foerdergeber": "Fördergeber"}.get(name, name)
        if name in ("Förderart", "Förderbereich", "Fördergebiet", "Förderberechtigte"):
            d[{"Förderart": "foerderart", "Förderbereich": "bereiche", "Fördergebiet": "gebiete", "Förderberechtigte": "berechtigte"}[name]] = liste_aus(text_aus(dd))
        elif name == "Fördergeber":
            d["foerdergeber"] = " ".join(text_aus(re.sub(r'(?s)<div class="(address|person-contact)">.*?</div>', "", dd)).split())
        elif name == "Ansprechpunkt":
            feld = lambda k: (lambda x: text_aus(x.group(1)) if x else "")(re.search(rf'(?s)<p class="{k}">(.*?)</p>', dd))
            email = re.search(r'href="mailto:([^"]+)"', dd)
            web = re.search(r'(?s)<p class="website">.*?href="([^"]+)"', dd)
            name_k = re.search(r'(?s)<p class="card--title">(.*?)</p>', dd)
            d["kontakt"] = {
                "name": text_aus(name_k.group(1)) if name_k else "", "strasse": feld("adr"), "ort": feld("locality"),
                "telefon": re.sub(r"^Tel:\s*", "", feld("tel")), "email": email.group(1) if email else "", "web": web.group(1) if web else "",
            }
        elif name.startswith("Weiterf"):
            d["links"] = [urllib.parse.urljoin(BASIS, html.unescape(u)) for u in re.findall(r'(?<![:\w])href="([^"#][^"]*)"', dd) if not u.startswith(("mailto:", "javascript:"))]
    reiter = [text_aus(t) for t in re.findall(r'(?s)<h2 class="horizontal--tab-opener"[^>]*>\s*<span class="btn--label">(.*?)</span>', seite)]
    inhalte = re.findall(r'(?s)<article class="content--tab-text">(.*?)</article>', seite)
    tabs = dict(zip([r.strip() for r in reiter], inhalte))
    zusammen = tabs.get("Kurzzusammenfassung")
    if zusammen is None and not tabs:
        haupt = re.search(r'(?s)<div class="container content--main[^"]*">(.*?)<div class="container', seite + '<div class="container')
        zusammen = re.sub(r"(?s)<aside.*?</aside>", "", haupt.group(1)) if haupt else ""
    teile = re.split(r"(?i)<h3[^>]*>(.*?)</h3>", zusammen or "")
    abschnitte = {text_aus(teile[i]).lower(): text_aus(teile[i + 1]) for i in range(1, len(teile) - 1, 2)}
    d["kurztext"] = abschnitte.get("kurztext") or text_aus(zusammen or "")[:600]
    d["volltext"] = (abschnitte.get("volltext") or ("" if "kurztext" in abschnitte else text_aus(zusammen or "")))[:8000]
    d["zusatzinfos"] = text_aus(tabs.get("Zusatzinfos", ""))[:6000]
    d["rechtsgrundlage"] = text_aus(tabs.get("Rechtsgrundlage", ""))[:3000]
    d["fristen"] = fristen_finden(" ".join([d["volltext"], d["zusatzinfos"], d["rechtsgrundlage"], d["kurztext"]]))
    return d


MONATE = {m: i + 1 for i, m in enumerate(["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"])}
FRIST_WORT = r"(?:frist|bis zum|bis spätestens|spätestens (?:am|bis)|stichtag|einreichung|eingehen|antragstellung (?:ist )?(?:bis|vom)|anträge? (?:können|sind) bis)"


def fristen_finden(text):
    """Daten, die nach einer Antragsfrist aussehen (ISO, sortiert). Nur Hinweis: der Text bleibt maßgeblich."""
    gefunden = set()
    for m in re.finditer(FRIST_WORT + r"[^.\n]{0,80}?(\d{1,2})\.\s*(\d{1,2}\.|" + "|".join(MONATE) + r")\s*(\d{4})", text, re.I):
        tag, monat, jahr = int(m.group(1)), m.group(2).rstrip(".").lower(), int(m.group(3))
        monat = int(monat) if monat.isdigit() else MONATE[monat]
        if 1 <= tag <= 31 and 1 <= monat <= 12 and 2000 < jahr < 2100:
            gefunden.add(f"{jahr:04d}-{monat:02d}-{tag:02d}")
    return sorted(gefunden)


# ------------------------------------------------------------------ Bewertung

def zielgruppen_bewerten(p, cfg):
    """[(zielgruppe, punkte, gruende)] fuer ein Programm und ein Profil."""
    if cfg.get("regionen") and not set(p.get("gebiete") or []) & set(cfg["regionen"]):
        return []
    titel = (p.get("titel") or "").lower()
    if any(a and a in titel for a in cfg.get("ausschluss", [])):
        return []
    text = " ".join([p.get("kurztext") or "", p.get("volltext") or ""]).lower()
    ergebnis = []
    for z in ("betrieb", "kunde"):
        berechtigt = set(cfg.get(f"berechtigte_{z}", []))
        if p.get("berechtigte") and berechtigt and not set(p["berechtigte"]) & berechtigt:
            continue
        woerter = [w for w in cfg.get(f"stichwoerter_{z}", []) if w]
        im_titel = [w for w in woerter if w in titel]
        im_text = [w for w in woerter if w in text and w not in im_titel]
        bereiche = [b for b in (p.get("bereiche") or []) if b in cfg.get(f"bereiche_{z}", [])]
        if not im_titel and not im_text:
            continue
        punkte = (cfg.get("score_titel", 3) if im_titel else 0) + cfg.get("score_text", 1) * min(2, len(im_text)) + (cfg.get("score_bereich", 1) if bereiche else 0)
        if punkte < cfg.get("mindest_score", 3):
            continue
        gruende = ([f"Titel: {', '.join(im_titel[:4])}"] if im_titel else []) + ([f"Text: {', '.join(im_text[:4])}"] if im_text else []) + ([f"Bereich: {', '.join(bereiche[:2])}"] if bereiche else [])
        ergebnis.append((z, punkte, gruende))
    return ergebnis


def bewerten(profile, programme):
    ergebnisse = []
    for p in programme:
        treffer = []
        for prof in profile:
            z = zielgruppen_bewerten(p, prof["config"])
            if z:
                treffer.append({"id": prof["id"], "punkte": max(x[1] for x in z), "zielgruppen": [x[0] for x in z],
                                "gruende": [f"{'Betrieb' if x[0] == 'betrieb' else 'Kunden'} – {g}" for x in z for g in x[2]]})
        if treffer:
            ergebnisse.append({"url": p["url"], "profile": treffer})
    return ergebnisse


def kandidat(p, profile):
    """Lohnt die Einzelseite? Titel-Treffer oder passender Foerderbereich bei passenden Berechtigten."""
    titel = p["titel"].lower()
    for prof in profile:
        cfg = prof["config"]
        if cfg.get("regionen") and not set(p["gebiete"]) & set(cfg["regionen"]):
            continue
        if any(a and a in titel for a in cfg.get("ausschluss", [])):
            continue
        for z in ("betrieb", "kunde"):
            berechtigt = set(cfg.get(f"berechtigte_{z}", []))
            if p["berechtigte"] and berechtigt and not set(p["berechtigte"]) & berechtigt:
                continue
            if any(w and w in titel for w in cfg.get(f"stichwoerter_{z}", [])) or set(p["bereiche"]) & set(cfg.get(f"bereiche_{z}", [])):
                return True
    return False


# ------------------------------------------------------------------ Abruf

def abrufen(e):
    pause = float(e.get("pause", 1.5))
    alle, vollstaendig = {}, []
    for region in e.get("regionen", ["_bundesweit", "berlin", "brandenburg"]):
        url, seiten, gesehen, erwartet = LISTE.format(region=region), 0, 0, None
        try:
            while url and seiten < MAX_SEITEN:
                seite = hole(url, pause=pause)
                programme, url, anzahl = liste_lesen(seite, region)
                erwartet = erwartet or anzahl
                seiten += 1
                gesehen += len(programme)
                for p in programme:
                    if p["url"] in alle:
                        alle[p["url"]]["gebiete"] = sorted(set(alle[p["url"]]["gebiete"]) | set(p["gebiete"]))
                    else:
                        alle[p["url"]] = p
                if url:
                    time.sleep(pause)
            log(f"{KUERZEL.get(region, region)}: {gesehen} Programme auf {seiten} Seiten (angegeben: {erwartet})")
            if erwartet and gesehen >= erwartet * 0.95:
                vollstaendig.append(KUERZEL.get(region, region))
        except Exception as fehler:
            log(f"{KUERZEL.get(region, region)}: Abruf abgebrochen nach {seiten} Seiten ({fehler})")
    aktuell = set(e.get("aktuell", []))
    kandidaten = [p for p in alle.values() if p["url"] not in aktuell and kandidat(p, e.get("profile", []))]
    budget = int(e.get("details_max", 120))
    log(f"{len(alle)} Programme, {len(kandidaten)} Einzelseiten fällig, davon {min(budget, len(kandidaten))} in diesem Lauf")
    fehler_folge = 0
    for p in kandidaten[:budget]:
        try:
            p["detail"] = detail_lesen(hole(p["url"], versuche=2, pause=pause))
            fehler_folge = 0
        except Exception as fehler:
            log(f"  Einzelseite {p['url']}: {fehler}")
            fehler_folge += 1
            if fehler_folge >= 5:
                log("  Fünf Fehler in Folge, Einzelseiten für heute beendet")
                break
        time.sleep(pause)
    return {"programme": list(alle.values()), "vollstaendig": vollstaendig}


def main():
    e = json.loads(sys.stdin.read() or "{}")
    if e.get("modus") == "bewerten":
        aus = {"ergebnisse": bewerten(e.get("profile", []), e.get("programme", []))}
    else:
        aus = abrufen(e)
    aus["log"] = PROTOKOLL
    json.dump(aus, sys.stdout, ensure_ascii=False)
    if e.get("modus") != "bewerten" and not aus["programme"]:
        sys.exit(2)


if __name__ == "__main__":
    main()

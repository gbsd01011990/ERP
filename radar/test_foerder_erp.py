"""Test des Foerdermittel-Radars mit nachgebauter Foerderdatenbank (Ergebnislisten mit Blaettern, Einzelseiten)."""
import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
import foerder_erp  # noqa: E402

# (pfad, titel, wer, was)
PROGRAMME = {
    "_bundesweit": [
        ("Bund/BMWE/digital-jetzt", "Digitalisierung im Mittelstand", "Unternehmen", "Digitalisierung, Beratung"),
        ("Bund/BMUV/klimaanpassung-sozial", "Klimaanpassung in sozialen Einrichtungen", "Kommune, Öffentliche Einrichtung, Verband/Vereinigung", "Umwelt- &amp; Naturschutz, Städtebau &amp; Stadterneuerung"),
        ("Bund/BKM/film", "Filmförderung", "Unternehmen", "Kultur, Medien &amp; Sport"),
    ],
    "berlin": [
        ("Land/Berlin/gruendach", "Förderung von Dach- und Fassadenbegrünung", "Privatperson, Unternehmen", "Umwelt- &amp; Naturschutz, Wohnungsbau &amp; Modernisierung"),
        ("Bund/BMUV/klimaanpassung-sozial", "Klimaanpassung in sozialen Einrichtungen", "Kommune, Öffentliche Einrichtung, Verband/Vereinigung", "Umwelt- &amp; Naturschutz, Städtebau &amp; Stadterneuerung"),
    ],
}
DETAILS = {
    "Bund/BMWE/digital-jetzt": ("Zuschuss", "Digitalisierung", "Unternehmen", "Sie erhalten einen Zuschuss für Software und Weiterbildung Ihrer Beschäftigten.", "Anträge können bis zum 31.03.2027 gestellt werden."),
    "Bund/BMUV/klimaanpassung-sozial": ("Zuschuss", "Umwelt- &amp; Naturschutz", "Kommune, Öffentliche Einrichtung", "Gefördert werden Entsiegelung, Begrünung und Verschattung von Freiflächen.", "Stichtag für Projektskizzen ist der 15. Januar 2027."),
    "Land/Berlin/gruendach": ("Zuschuss", "Umwelt- &amp; Naturschutz", "Privatperson, Unternehmen", "Gefördert werden Dachbegrünung und Fassadenbegrünung sowie Regenwasserbewirtschaftung.", ""),
}


def karte(pfad, titel, wer, was):
    return f"""<div class="card card--horizontal card--fundingprogram"> <p class="card--topline">Förderprogramm</p>
<p class="card--title"> <a class="" title="Öffnet die Einzelsicht" href="FDB/Content/DE/Foerderprogramm/{pfad}.html"> <span class="link--label"> {titel} </span> </a> </p>
<dl class="grid-modul--two-elements document-info-fundingprogram"> <dt> Wer wird gefördert?: </dt> <dd> {wer} </dd> <dt> Was wird gefördert?: </dt> <dd> {was} </dd> </dl> </div>"""


def liste(region, seite):
    eintraege = PROGRAMME[region]
    teil = eintraege[(seite - 1) * 2: seite * 2]
    weiter = f'<a class="forward button" href="SiteGlobals/FDB/Forms/Suche/Foederprogrammsuche_Formular.html?gtp=x_list%3D{seite + 1}&amp;cl2Processes_Foerdergebiet={region}">weiter</a>' if seite * 2 < len(eintraege) else ""
    return f'<html><body><span id="hits--count">{len(eintraege)}</span>{"".join(karte(*k) for k in teil)}{weiter}</body></html>'


def detail(pfad):
    art, bereich, wer, kurz, voll = DETAILS[pfad]
    titel = next(t for r in PROGRAMME.values() for p, t, *_ in r if p == pfad)
    return f"""<html><body><main class="main"><div class="jumbotron"><h1 class="title"> {titel} </h1>
<dl class="grid-modul--two-elements document-info-fundingprogram"> <dt> Förderart: </dt> <dd> {art} </dd> <dt> Förderbereich: </dt> <dd> {bereich} </dd>
<dt> Fördergebiet: </dt> <dd> bundesweit </dd> <dt> Förderberechtigte: </dt> <dd> {wer} </dd>
<dt>Fördergeber:</dt> <dd class="card"><p class="card--title"><a title="Öffnet die Einzelsicht" href="x"><span class="link--label">Ministerium</span></a></p></dd>
<dt>Ansprechpunkt:</dt> <dd class="card"><p class="card--title"><a href="y"><span class="link--label">Förderbank</span></a></p><div class="address"><p class="adr">Straße 1</p><p class="locality">10115 Berlin</p></div>
<div class="person-contact"><p class="tel">Tel: 030 123</p><p class="email"><a href="mailto:foerderung@example.de">foerderung@example.de</a></p></div></dd>
<dt>Weiterführende Links:</dt><dd><a class="link link-external" href="https://example.de/antrag"><svg><use xlink:href="#svg__icon-external"></use></svg><span>Antrag</span></a></dd></dl></div>
<div class="container content--main for-aside-right horizontal--tab"><div class="content"><div class="rich--text">
<h2 class="horizontal--tab-opener" data-toggleid="tab1"> <span class="btn--label">Kurzzusammenfassung</span> </h2>
<article class="content--tab-text"><div class="rich--text"><h3>Kurztext</h3><p>{kurz}</p></div><div class="rich--text"><h3>Volltext</h3><p>{kurz}</p><p>{voll}</p></div></article>
<h2 class="horizontal--tab-opener" data-toggleid="tab2"> <span class="btn--label">Zusatzinfos </span> </h2>
<article class="content--tab-text"><div class="rich--text"><h3>Voraussetzungen</h3><ul><li>KMU</li><li>Sitz in Deutschland</li></ul></div></article>
</div></div></div></main></body></html>"""


class Attrappe(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path.endswith("Foederprogrammsuche_Formular.html"):
            region = q["cl2Processes_Foerdergebiet"][0]
            if region == "brandenburg":
                self.send_response(503); self.end_headers(); return
            seite = int(q["gtp"][0].split("=")[-1]) if "gtp" in q else 1
            body = liste(region, seite)
        elif "/Foerderprogramm/" in u.path:
            pfad = u.path.split("/Foerderprogramm/")[1].removesuffix(".html")
            if pfad not in DETAILS:
                self.send_response(404); self.end_headers(); return
            body = detail(pfad)
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers(); self.wfile.write(body.encode("utf-8"))


PROFIL = {
    "regionen": ["bundesweit", "Berlin", "Brandenburg"],
    "stichwoerter_betrieb": ["digitalisierung", "software", "weiterbildung"],
    "stichwoerter_kunde": ["dachbegrünung", "fassadenbegrünung", "begrünung", "entsiegelung", "klimaanpassung", "regenwasser"],
    "berechtigte_betrieb": ["Unternehmen"],
    "berechtigte_kunde": ["Privatperson", "Kommune", "Öffentliche Einrichtung", "Verband/Vereinigung", "Unternehmen"],
    "bereiche_betrieb": ["Digitalisierung", "Aus- & Weiterbildung"],
    "bereiche_kunde": ["Umwelt- & Naturschutz", "Städtebau & Stadterneuerung"],
    "ausschluss": ["film"], "mindest_score": 3, "score_titel": 3, "score_text": 1, "score_bereich": 1,
}


class FoerderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Attrappe)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.env = {**os.environ, "FOERDER_URL": f"http://127.0.0.1:{cls.server.server_address[1]}"}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def lauf(self, eingabe):
        r = subprocess.run([sys.executable, "-I", os.path.join(HIER, "foerder_erp.py")], input=json.dumps(eingabe), capture_output=True, text=True, env=self.env, timeout=120)
        self.assertIn(r.returncode, (0, 2), r.stderr)
        return json.loads(r.stdout)

    def test_abruf(self):
        e = self.lauf({"modus": "abruf", "regionen": ["_bundesweit", "berlin", "brandenburg"], "profile": [{"id": "rd", "config": PROFIL}], "pause": 0})
        p = {x["url"].split("/Foerderprogramm/")[1]: x for x in e["programme"]}
        self.assertEqual(len(p), 4)  # Klimaanpassung steht in Bund und Berlin, zählt einmal
        self.assertEqual(sorted(p["Bund/BMUV/klimaanpassung-sozial.html"]["gebiete"]), ["Berlin", "bundesweit"])
        # Brandenburg nicht erreichbar: nicht vollständig, damit nichts fälschlich als beendet gilt
        self.assertEqual(sorted(e["vollstaendig"]), ["Berlin", "bundesweit"])
        self.assertIn("Kultur, Medien & Sport", p["Bund/BKM/film.html"]["bereiche"])
        self.assertNotIn("detail", p["Bund/BKM/film.html"])  # Ausschluss: keine Einzelseite
        d = p["Bund/BMWE/digital-jetzt.html"]["detail"]
        self.assertEqual(d["foerderart"], ["Zuschuss"])
        self.assertEqual(d["kontakt"]["email"], "foerderung@example.de")
        self.assertEqual(d["links"], ["https://example.de/antrag"])
        self.assertEqual(d["fristen"], ["2027-03-31"])
        self.assertIn("• KMU", d["zusatzinfos"])
        self.assertEqual(p["Bund/BMUV/klimaanpassung-sozial.html"]["detail"]["fristen"], ["2027-01-15"])

    def test_aktuelle_ohne_einzelseite(self):
        bekannt = [f"{self.env['FOERDER_URL']}/FDB/Content/DE/Foerderprogramm/Land/Berlin/gruendach.html"]
        e = self.lauf({"modus": "abruf", "regionen": ["berlin"], "profile": [{"id": "rd", "config": PROFIL}], "aktuell": bekannt, "pause": 0})
        p = {x["url"].split("/Foerderprogramm/")[1]: x for x in e["programme"]}
        self.assertNotIn("detail", p["Land/Berlin/gruendach.html"])
        self.assertIn("detail", p["Bund/BMUV/klimaanpassung-sozial.html"])

    def test_bewerten(self):
        kud = {**PROFIL, "stichwoerter_kunde": ["baum", "allee"], "regionen": ["Brandenburg"]}
        programme = [
            {"url": "a", "titel": "Digitalisierung im Mittelstand", "kurztext": "Software", "volltext": "", "berechtigte": ["Unternehmen"], "bereiche": ["Digitalisierung"], "gebiete": ["bundesweit"]},
            {"url": "b", "titel": "Förderung von Dach- und Fassadenbegrünung", "kurztext": "", "volltext": "Regenwasser", "berechtigte": ["Privatperson"], "bereiche": ["Umwelt- & Naturschutz"], "gebiete": ["Berlin"]},
            {"url": "c", "titel": "Klimaanpassung", "kurztext": "", "volltext": "", "berechtigte": ["Hochschule"], "bereiche": [], "gebiete": ["bundesweit"]},
            {"url": "d", "titel": "Stadtentwicklung", "kurztext": "Gefördert wird auch Entsiegelung.", "volltext": "", "berechtigte": ["Kommune"], "bereiche": [], "gebiete": ["bundesweit"]},
        ]
        r = {x["url"]: x["profile"] for x in foerder_erp.bewerten([{"id": "rd", "config": PROFIL}, {"id": "kud", "config": kud}], programme)}
        self.assertEqual(r["a"][0]["zielgruppen"], ["betrieb"])
        self.assertEqual(r["a"][0]["punkte"], 5)  # Titel 3 + Text 1 + Bereich 1
        self.assertEqual(r["b"][0]["zielgruppen"], ["kunde"])
        self.assertEqual([x["id"] for x in r["b"]], ["rd"])  # KUD: nur Brandenburg
        self.assertNotIn("c", r)  # Hochschule ist weder Betrieb noch Kunde
        self.assertNotIn("d", r)  # nur ein Textwort: 1 Punkt, unter der Schwelle


if __name__ == "__main__":
    unittest.main()

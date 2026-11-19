"""Test des Radars mit nachgebautem Datenservice (Tagesexport, eForms-Detail) und Berlin-Feed."""
import csv
import io
import json
import os
import subprocess
import sys
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

HIER = os.path.dirname(os.path.abspath(__file__))


def csv_text(spalten, zeilen):
    f = io.StringIO()
    w = csv.DictWriter(f, fieldnames=spalten)
    w.writeheader()
    for z in zeilen:
        w.writerow(z)
    return f.getvalue()


def export_zip():
    n = [
        ("a1", "competition", "Grünflächenpflege Bezirk Spandau", "Pflege von Rasen und Gehölzen", "services", "77313000", "13597", "DE300", "Bezirksamt Spandau"),
        ("a2", "competition", "Baumkontrollen Potsdam", "Kontrolle und Baumpflege", "services", "77211500", "14469", "DE423", "Landeshauptstadt Potsdam"),
        ("a3", "competition", "Lieferung von Fahrzeugen", "Rasen", "supplies", "34100000", "10117", "DE300", "Senat"),
        ("a4", "competition", "Grünflächenpflege München", "Rasen", "services", "77313000", "80331", "DE212", "Stadt München"),
        ("a5", "result", "Baumpflege Zuschlag", "Baumpflege", "services", "77211500", "14467", "DE423", "Stadt"),
        ("a6", "competition", "Planungsleistungen Freianlagen", "Grünanlage", "services", "71000000", "10115", "DE300", "Senat"),
    ]
    dateien = {
        "notice.csv": csv_text(["noticeIdentifier", "noticeVersion", "formType", "noticeType", "publicationDate"], [{"noticeIdentifier": k, "noticeVersion": "01", "formType": f, "noticeType": "cn", "publicationDate": "2026-11-18"} for k, f, *_ in n]),
        "purpose.csv": csv_text(["noticeIdentifier", "lotIdentifier", "title", "description", "mainNature", "estimatedValue", "estimatedValueCurrency"], [{"noticeIdentifier": k, "lotIdentifier": "", "title": t, "description": d, "mainNature": a, "estimatedValue": "120000", "estimatedValueCurrency": "EUR"} for k, _, t, d, a, *_ in n]),
        "classification.csv": csv_text(["noticeIdentifier", "mainClassificationCode", "additionalClassificationCodes"], [{"noticeIdentifier": k, "mainClassificationCode": c, "additionalClassificationCodes": ""} for k, _, _, _, _, c, *_ in n]),
        "placeOfPerformance.csv": csv_text(["noticeIdentifier", "placePerformanceCity", "placePerformancePostCode", "placePerformanceCountrySubdivision"], [{"noticeIdentifier": k, "placePerformanceCity": "Ort", "placePerformancePostCode": plz, "placePerformanceCountrySubdivision": nuts} for k, _, _, _, _, _, plz, nuts, _ in n]),
        "organisation.csv": csv_text(["noticeIdentifier", "organisationRole", "organisationName", "organisationCity", "organisationCountrySubdivision", "organisationPostCode"], [{"noticeIdentifier": k, "organisationRole": "buyer", "organisationName": o, "organisationCity": "Ort", "organisationCountrySubdivision": "", "organisationPostCode": ""} for k, *_, o in n]),
    }
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as z:
        for name, text in dateien.items():
            z.writestr(name, "﻿" + text)
    return puffer.getvalue()


EFORMS = b"""<?xml version="1.0"?><ContractNotice xmlns:cac="urn:a" xmlns:cbc="urn:b"><cac:TenderSubmissionDeadlinePeriod><cbc:EndDate>2026-12-01+01:00</cbc:EndDate><cbc:EndTime>10:00:00+01:00</cbc:EndTime></cac:TenderSubmissionDeadlinePeriod>
<cbc:ProcedureCode>open</cbc:ProcedureCode><cbc:URI>https://vergabemarktplatz.brandenburg.de/VMPSatellite/notice/XYZ/documents</cbc:URI></ContractNotice>"""
RSS = """<?xml version="1.0" encoding="UTF-8"?><rss><channel>
<item><title>Heckenschnitt Grünanlage Tiergarten</title><link>https://www.berlin.de/vergabeplattform/tenderId/4711</link><description>Ausführungsort: 10557 Berlin&lt;br&gt;Eröffnungstermin: 03.12.2026, 10:00&lt;br&gt;Verfahrensart: Öffentliche Ausschreibung&lt;br&gt;Online seit: 17.11.2026</description></item>
<item><title>Grünflächenpflege Bezirk Spandau</title><link>https://www.berlin.de/vergabeplattform/tenderId/4712</link><description>Ausführungsort: 13597 Berlin</description></item>
<item><title>Heckenschnitt ohne Nummer</title><link>https://www.berlin.de/x</link><description>Ausführungsort: 10115 Berlin</description></item>
</channel></rss>""".encode("utf-8")


class Attrappe(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/api/notice-exports"):
            if "2026-11-17" in self.path:
                self.send_response(404); self.end_headers(); return
            body, typ = export_zip(), "application/zip"
        elif self.path.startswith("/api/notices/"):
            body, typ = EFORMS, "application/xml"
        elif self.path.startswith("/feed"):
            body, typ = RSS, "application/rss+xml"
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", typ); self.end_headers(); self.wfile.write(body)


class RadarTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Attrappe)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        port = cls.server.server_address[1]
        cls.env = {**os.environ, "RADAR_BUND_URL": f"http://127.0.0.1:{port}", "RADAR_BERLIN_URL": f"http://127.0.0.1:{port}/feed"}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def lauf(self, profile, tage=("2026-11-17", "2026-11-18"), bekannt=()):
        r = subprocess.run([sys.executable, "-I", os.path.join(HIER, "radar_erp.py")], input=json.dumps({"tage": list(tage), "profile": profile, "bekannt": list(bekannt)}),
                           capture_output=True, text=True, env=self.env, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_zwei_profile(self):
        galabau = json.load(open(os.path.join(HIER, "profil-galabau.json"), encoding="utf-8"))
        baum = {**galabau, "cpv_praefixe": ["77211", "77341"], "keywords": ["baum"], "region_nuts": ["DE4"], "region_plz": ["14"]}
        e = self.lauf([{"id": "rd", "config": galabau}, {"id": "kud", "config": baum}])
        self.assertEqual(e["tage_geladen"], 1)
        t = {x["kennung"]: x for x in e["treffer"]}
        # Spandau (Berlin, CPV + Titel) für GaLaBau; Potsdam für beide; München außerhalb; Fahrzeuglieferung, Zuschlag und Planung raus
        self.assertIn("a1", t); self.assertIn("a2", t)
        for raus in ("a3", "a4", "a5", "a6"):
            self.assertNotIn(raus, t)
        self.assertEqual(sorted(p["id"] for p in t["a2"]["profile"]), ["kud", "rd"])
        self.assertEqual([p["id"] for p in t["a1"]["profile"]], ["rd"])
        self.assertEqual(t["a2"]["frist_datum"], "2026-12-01")
        self.assertEqual(t["a2"]["frist_zeit"], "10:00")
        self.assertTrue(t["a2"]["portal"].startswith("https://vergabemarktplatz.brandenburg.de"))
        self.assertTrue(t["a2"]["bekanntmachung"].endswith("/a2"))
        # Berlin: neuer Heckenschnitt mit Frist; Spandau-Dublette zum Bund zusammengefasst
        berlin = [x for x in e["treffer"] if x["quelle"] == "Vergabeplattform Berlin"]
        self.assertIn("berlin-4711", [x["kennung"] for x in berlin])
        self.assertNotIn("berlin-4712", t)
        self.assertEqual(t["berlin-4711"]["frist_datum"], "2026-12-03")

    def test_stabile_kennung(self):
        galabau = json.load(open(os.path.join(HIER, "profil-galabau.json"), encoding="utf-8"))
        a = {x["kennung"] for x in self.lauf([{"id": "rd", "config": galabau}], tage=())["treffer"]}
        b = {x["kennung"] for x in self.lauf([{"id": "rd", "config": galabau}], tage=())["treffer"]}
        ohne = [k for k in a if k.startswith("berlin-") and not k[7:].isdigit()]
        self.assertEqual(len(ohne), 1)
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()

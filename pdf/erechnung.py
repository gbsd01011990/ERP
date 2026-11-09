# -*- coding: utf-8 -*-
"""
E-Rechnung mit factur-x (Akretion, BSD-Lizenz).

    python3 erechnung.py einbetten < {"pdf": <base64>, "xml": "<…>", "titel": "…"}  → PDF/A-3 (ZUGFeRD) auf stdout
    python3 erechnung.py pruefen   < {"xml": "<…>"}                                → {"ok": true} oder {"fehler": "…"}

Die Schemaprüfung (XSD EN 16931) läuft bei beidem. Netzwerk wird nicht benutzt.
"""
import base64
import json
import logging
import sys

logging.disable(logging.CRITICAL)  # factur-x schreibt sonst Hinweise auf stderr


def main():
    befehl = sys.argv[1]
    d = json.load(sys.stdin)
    import facturx
    xml = d["xml"].encode("utf-8")
    if befehl == "pruefen":
        try:
            facturx.xml_check_xsd(xml, flavor="factur-x", level="en16931")
            print(json.dumps({"ok": True}))
        except Exception as e:  # noqa: BLE001 – Meldung an das ERP weitergeben
            print(json.dumps({"fehler": str(e)[:2000]}))
        return
    if befehl == "einbetten":
        pdf = base64.b64decode(d["pdf"])
        raus = facturx.generate_from_binary(
            pdf, xml, flavor="factur-x", level="en16931", check_xsd=True, lang="de-DE",
            pdf_metadata={"author": d.get("autor", ""), "keywords": "Factur-X, ZUGFeRD, Rechnung",
                          "title": d.get("titel", "Rechnung"), "subject": d.get("titel", "Rechnung")},
        )
        sys.stdout.buffer.write(raus)
        return
    raise SystemExit(f"Unbekannter Befehl {befehl}")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
Eingangsrechnung lesen: XRechnung (CII oder UBL), ZUGFeRD/Factur-X-PDF oder reines PDF.

    python3 eingang.py < {"name": "re.pdf", "daten": <base64>}  → JSON

Liefert das Format, die Schemaprüfung und die Angaben nach EN 16931 in einer flachen Form.
Ein PDF ohne eingebettetes XML ergibt nur {"format": "PDF"} – die Angaben erfasst dann ein Mensch.
"""
import base64
import json
import logging
import re
import sys

logging.disable(logging.CRITICAL)


def zahl(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def text(v):
    return str(v) if v not in (None, "") else None


def lesen(name, roh):
    import facturx
    fmt, xml = None, None
    if roh[:5] == b"%PDF-":
        try:
            _, xml = facturx.get_xml_from_pdf(roh, check_xsd=False)
        except Exception:  # noqa: BLE001
            xml = None
        if not xml:
            return {"format": "PDF"}
        fmt = "ZUGFERD"
    else:
        xml = roh
    kopfzeilen = xml[:4000].decode("utf-8", "ignore")
    if fmt is None:
        if "CrossIndustryInvoice" in kopfzeilen:
            fmt = "XRECHNUNG_CII"
        elif "urn:oasis:names:specification:ubl" in kopfzeilen:
            fmt = "XRECHNUNG_UBL"
        else:
            return {"fehler": "Keine E-Rechnung erkannt (erwartet: XRechnung als CII oder UBL, ZUGFeRD-PDF oder PDF)."}
    xsd_ok, xsd_fehler = True, None
    try:
        d = facturx.parse_ubl_cii_xml(xml, check_xsd=True)
    except Exception as e:  # noqa: BLE001 – Schemafehler: trotzdem lesen, aber melden
        xsd_ok, xsd_fehler = False, str(e)[:1500]
        try:
            d = facturx.parse_ubl_cii_xml(xml, check_xsd=False)
        except Exception as e2:  # noqa: BLE001
            return {"fehler": f"E-Rechnung nicht lesbar: {str(e2)[:500]}"}

    typ = text(d.get("BT-3"))
    vz = -1 if typ in ("381", "261", "262", "296", "308", "396", "420", "458", "532") else 1  # Gutschriften
    s = d.get("BG-4") or {}
    k = d.get("BG-7") or {}
    kontakte = s.get("contacts") or [{}]
    steuern = [{"basis": (zahl(t.get("BT-116")) or 0) * vz, "betrag": (zahl(t.get("BT-117")) or 0) * vz,
                "kategorie": text(t.get("BT-118")), "satz": zahl(t.get("BT-119"))} for t in d.get("BG-23") or []]
    bedingungen = text(d.get("BT-20")) or ""
    m = re.search(r"#SKONTO#TAGE=(\d+)#PROZENT=([\d.]+)#", bedingungen)
    positionen = [{
        "nr": int(zahl(p.get("BT-126")) or i + 1), "artNr": text(p.get("BT-155")), "text": text(p.get("BT-153")) or "",
        "menge": (zahl(p.get("BT-129")) or 0) * vz, "einheit": text(p.get("BT-130")), "preis": zahl(p.get("BT-146")) or 0,
        "gesamt": (zahl(p.get("BT-131")) or 0) * vz, "steuersatz": zahl(p.get("BT-152")), "kategorie": text(p.get("BT-151")),
    } for i, p in enumerate(d.get("BG-25") or [])]
    return {
        "format": fmt, "xml": xml.decode("utf-8", "replace"), "xsdOk": xsd_ok, "xsdFehler": xsd_fehler,
        "daten": json.loads(json.dumps(d, default=str)),
        "kopf": {
            "typ": typ, "rechnungsnummer": text(d.get("BT-1")), "datum": text(d.get("BT-2")), "faellig": text(d.get("BT-9")),
            "bestellnummer": text(d.get("BT-13")), "leistungsdatum": text(d.get("BT-72")) or
                (f"{d.get('BT-73')} bis {d.get('BT-74')}" if d.get("BT-73") else None),
            "netto": (zahl(d.get("BT-109")) or 0) * vz, "mwst": (zahl(d.get("BT-110")) or 0) * vz, "brutto": (zahl(d.get("BT-112")) or 0) * vz,
            "vorauszahlung": (zahl(d.get("BT-113")) or 0) * vz, "zahlbetrag": (zahl(d.get("BT-115")) or 0) * vz,
            "summePositionen": (zahl(d.get("BT-106")) or 0) * vz,
            "iban": text(d.get("BT-84")), "bedingungen": bedingungen or None,
            "skontoTage": int(m.group(1)) if m else 0, "skontoProzent": float(m.group(2)) if m else 0,
            "lieferant": {"name": text(s.get("name")), "ustId": text(s.get("vat_identifier")), "steuernummer": text(s.get("tax_registration_identifier")),
                          "strasse": text(s.get("addr_l1")), "plz": text(s.get("postcode")), "ort": text(s.get("city")),
                          "land": text(s.get("country_code")), "email": text(kontakte[0].get("email")) or text(s.get("einvoicing_addr")),
                          "telefon": text(kontakte[0].get("phone"))},
            "kaeufer": {"name": text(k.get("name")), "ustId": text(k.get("vat_identifier"))},
        },
        "steuern": steuern, "positionen": positionen,
    }


if __name__ == "__main__":
    e = json.load(sys.stdin)
    try:
        print(json.dumps(lesen(e.get("name", ""), base64.b64decode(e["daten"])), ensure_ascii=False))
    except Exception as x:  # noqa: BLE001
        print(json.dumps({"fehler": f"Datei nicht lesbar: {str(x)[:500]}"}))

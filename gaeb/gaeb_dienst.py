# -*- coding: utf-8 -*-
"""
GAEB-Import und -Export für das ERP auf Basis von pyGAEB (MIT-Lizenz).

    python3 gaeb_dienst.py lesen < {"name": "...", "daten": "<base64>"}
    python3 gaeb_dienst.py schreiben < {"phase": "X84", "quelle": {...}?, "positionen": [...], "kopf": {...}}

Ausgabe immer JSON auf stdout. Fehler: {"fehler": "..."} und Exitcode 2.
Die App (src/lib/gaeb.ts) übernimmt Zuordnung zu Angeboten, Aufmaß und Lager.
"""
import base64
import json
import logging
import os
import sys
from decimal import Decimal, ROUND_HALF_UP

from pygaeb import BoQBuilder, GAEBParser, GAEBWriter, PhaseTransition
from pygaeb.models.document import Party
from pygaeb.models.enums import DocumentKind, ExchangePhase, ItemType, Provis
from pygaeb.models.order import Address

logging.disable(logging.WARNING)  # Warnungen sammeln wir selbst, nicht auf stderr

PROG = {"prog_system": "ERP Baumpflegebund", "prog_name": "ERP"}
LESBAR = {"X80", "X81", "X82", "X83", "X84", "X85", "X86", "X88", "X89", "X89B", "X52", "X31", "X93", "X94", "X96", "X97"}
SCHREIBBAR = {"X80", "X81", "X82", "X83", "X84", "X85", "X86"}
OHNE_PREISE = {"X80", "X81", "X83"}


def zahl(v):
    return None if v is None else float(v)


def text(rt):
    if rt is None:
        return ""
    for attr in ("plain_text", "text"):
        v = getattr(rt, attr, None)
        if isinstance(v, str):
            return v.strip()
    return str(rt).strip()


def adresse(a):
    if a is None:
        return None
    return {k: getattr(a, k, None) for k in ("name", "name2", "street", "pcode", "city", "email", "phone")}


# ------------------------------------------------------------------ lesen
def positionen_aus_boq(boq):
    out = []

    def kategorie(c, pfad, ebene):
        oz = ".".join(p for p in pfad + [c.rno or ""] if p)
        out.append({"art": "GRUPPE", "ebene": ebene, "oz": oz, "gaebId": c.id, "kurztext": c.label or f"Titel {oz}"})
        for sub in c.subcategories:
            kategorie(sub, pfad + [c.rno or ""], ebene + 1)
        for it in c.items:
            typ = it.item_type.value if it.item_type else "Normal"
            if it.item_type == ItemType.TEXT_ONLY:
                out.append({"art": "TEXT", "ebene": ebene + 1, "oz": "", "gaebId": it.id, "kurztext": it.short_text or "Hinweis", "langtext": text(it.long_text)})
                continue
            bedarf = it.item_type in (ItemType.EVENTUAL, ItemType.ALTERNATIVE) or it.provis is not None
            out.append({
                "art": "POSITION", "ebene": ebene + 1, "oz": getattr(it, "full_oz", None) or it.oz, "gaebId": it.id,
                "kurztext": it.short_text or "", "langtext": text(it.long_text),
                "menge": zahl(it.qty), "mengeOffen": bool(it.qty_tbd), "einheit": it.unit or "",
                "ep": zahl(it.unit_price), "gp": zahl(it.total_price), "typ": typ,
                "bedarf": bool(bedarf and it.provis != Provis.WITH_TOTAL),
                "bedarfMitGp": it.provis == Provis.WITH_TOTAL,
                "preisanteile": [float(x) for x in (it.up_components or [])],
            })

    lots = boq.lots
    for lot in lots:
        cats = lot.body.categories if lot.body else []
        if len(lots) > 1 and not lot.synthetic:
            out.append({"art": "GRUPPE", "ebene": 0, "oz": lot.rno or "", "gaebId": lot.id, "kurztext": lot.label or f"Los {lot.rno}"})
        for c in cats:
            kategorie(c, [lot.rno] if (len(lots) > 1 and not lot.synthetic and lot.rno) else [], 1)
    return out


def lesen(eingabe):
    roh = base64.b64decode(eingabe["daten"])
    doc = GAEBParser.parse_bytes(roh, filename=eingabe.get("name") or "datei.X83")
    phase = doc.exchange_phase.normalized().value if doc.exchange_phase else None
    erg = {
        "phase": phase, "version": doc.source_version.value if doc.source_version else None,
        "art": doc.document_kind.value if doc.document_kind else None,
        "warnungen": [r.message for r in doc.validation_results if getattr(r.severity, "value", "") in ("ERROR", "WARNING", "error", "warning")][:50],
    }
    if doc.document_kind == DocumentKind.PROCUREMENT and doc.award:
        a = doc.award
        info = a.boq.boq_info if a.boq else None
        erg.update({
            "projekt": {"name": a.project_name or a.lbl_prj, "nummer": a.project_no, "beschreibung": a.description,
                        "vergabeNr": a.award_no or a.contract_no, "boqId": a.boq_id},
            "auftraggeber": adresse(a.owner_address),
            "preisanteilNamen": list(info.lbl_up_comps or []) if info else [],
            "positionen": positionen_aus_boq(a.boq) if a.boq else [],
            "summe": zahl(doc.grand_total),
        })
    elif doc.document_kind == DocumentKind.QUANTITY:
        qd = doc.qty_determination
        erg["mengen"] = [
            {"oz": it.oz, "menge": zahl(it.qty), "zeilen": [d.takeoff_row.raw for d in it.determ_items if d.takeoff_row]}
            for it in doc.iter_items()
        ]
        erg["projekt"] = {"name": getattr(qd.boq, "ref_boq_name", None) if qd and qd.boq else None}
    elif doc.document_kind == DocumentKind.TRADE and doc.order:
        erg["handel"] = [
            {"artNr": i.art_no, "lieferantArtNr": i.supplier_art_no, "ean": i.ean, "kurztext": i.short_text, "menge": zahl(i.qty),
             "einheit": i.unit, "angebotspreis": zahl(i.offer_price), "nettopreis": zahl(i.net_price), "preisbasis": zahl(i.price_basis)}
            for i in doc.order.items
        ]
    return erg


# ------------------------------------------------------------------ schreiben
def partei(d):
    if not d:
        return None
    return Party(address=Address(name=d.get("name") or "", name2=d.get("name2"), street=d.get("strasse") or "", pcode=d.get("plz") or "",
                                 city=d.get("ort") or "", email=d.get("email"), phone=d.get("telefon"), vat_id=d.get("ustId")))


def runden(v):
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def schreiben(e):
    phase = e["phase"]
    if phase not in SCHREIBBAR:
        raise ValueError(f"Export als {phase} ist nicht vorgesehen.")
    ziel = ExchangePhase(phase)
    kopf = e.get("kopf") or {}
    preise = {p["schluessel"]: p for p in e.get("preise", [])}

    if e.get("quelle"):
        # Ausschreibung des Auftraggebers zurückgeben: Struktur, IDs und OZ bleiben unverändert
        q = e["quelle"]
        doc = GAEBParser.parse_bytes(base64.b64decode(q["daten"]), filename=q.get("name") or "quelle.X83")
        if phase in ("X84", "X85"):
            doc = PhaseTransition.tender_to_bid(doc)
        anteile_n = (doc.award.boq.boq_info.no_up_comps or 0) if doc.award.boq.boq_info else 0
        fehlend = 0
        for it in doc.iter_items():
            if it.item_type == ItemType.TEXT_ONLY:
                continue
            p = preise.get(it.id) or preise.get(getattr(it, "full_oz", None) or it.oz)
            if phase in OHNE_PREISE:
                it.unit_price = None
                it.total_price = None
                continue
            if not p or p.get("ep") is None:
                fehlend += 1
                continue
            it.unit_price = runden(p["ep"])
            it.total_price = runden(Decimal(str(p["ep"])) * it.qty) if it.qty is not None else None
            if anteile_n and p.get("anteile"):
                it.up_components = [runden(x) for x in p["anteile"][:anteile_n]]
        if kopf.get("bieter"):
            doc.award.contractor = partei(kopf["bieter"])
        daten, warnungen = GAEBWriter.to_bytes(doc, phase=ziel, **PROG)
        if fehlend:
            warnungen = [f"{fehlend} Position(en) ohne Einheitspreis."] + list(warnungen)
    else:
        # Eigenes LV aufbauen (z. B. Angebot an Privatkunden, Ausschreibung an Nachunternehmer)
        b = BoQBuilder(phase=phase, version="3.3")
        b.project(no=kopf.get("projektNr") or "", name=kopf.get("projektName") or "LV", currency="EUR")
        # Ordnungszahlen je Ebene selbst vergeben: Titel zweistellig, Positionen vierstellig in 10er-Schritten.
        # RNoPart darf laut Schema keinen Punkt enthalten (nur die jeweilige Stufe).
        stapel = []  # Einträge: {"ebene", "cb", "titel": Zähler Untertitel, "pos": Zähler Positionen}
        oben = {"titel": 0}
        texte = 0

        def neue_kategorie(ebene, titel):
            while stapel and stapel[-1]["ebene"] >= ebene:
                stapel.pop()
            eltern = stapel[-1] if stapel else oben
            eltern["titel"] += 1
            rno = f"{eltern['titel']:02d}"
            cb = stapel[-1]["cb"].add_subcategory(rno, titel) if stapel else b.add_category(rno, titel)
            stapel.append({"ebene": ebene, "cb": cb, "titel": 0, "pos": 0})

        for p in e.get("positionen", []):
            if p["art"] == "GRUPPE":
                neue_kategorie(p.get("ebene", 1), p["kurztext"])
                continue
            if p["art"] == "TEXT":
                texte += 1  # GAEB-Hinweistexte schreibt pyGAEB nicht austauschfähig – weglassen
                continue
            if not stapel:
                neue_kategorie(1, "Leistungen")
            k = stapel[-1]
            k["pos"] += 1
            mit_preis = phase not in OHNE_PREISE
            extra = {"provis": Provis.WITHOUT_TOTAL} if p.get("bedarf") else {}
            h = k["cb"].add_item(
                f"{k['pos'] * 10:04d}", p["kurztext"], qty=p.get("menge"), unit=p.get("einheit") or "Stk",
                unit_price=p.get("ep") if mit_preis else None,
                item_type=ItemType.EVENTUAL if p.get("bedarf") else ItemType.NORMAL, **extra,
            )
            if p.get("langtext"):
                h.set_long_text(p["langtext"])
        doc = b.build()
        if kopf.get("bieter") and phase in ("X84", "X85", "X86"):
            doc.award.contractor = partei(kopf["bieter"])
        if kopf.get("auftraggeber"):
            ag = partei(kopf["auftraggeber"])
            doc.award.owner_address = ag.address if ag else None
        daten, warnungen = GAEBWriter.to_bytes(doc, phase=ziel, **PROG)
        if texte:
            warnungen = [f"{texte} Hinweistext(e) nicht übernommen – GAEB-Hinweistexte werden noch nicht austauschfähig geschrieben."] + list(warnungen)

    # Prüfung gegen die offiziellen GAEB-Schemas, wenn sie auf dem Server liegen (GAEB_XSD_DIR)
    xsd = os.environ.get("GAEB_XSD_DIR")
    if xsd and os.path.isdir(xsd):
        pruefung = GAEBWriter.validate_against_xsd(doc, phase=ziel, xsd_dir=xsd)
        if pruefung is not None and not pruefung.valid:
            warnungen = [f"Schemaprüfung: Zeile {f.line}: {f.message}" for f in pruefung.errors[:20]] + list(warnungen)

    # Hinweise der Bibliothek, die nur Formatregeln beschreiben, sind für Anwender kein Problem
    warnungen = [w for w in warnungen if "not written" not in w and "placeholder" not in w]
    return {"daten": base64.b64encode(daten).decode(), "warnungen": warnungen}


if __name__ == "__main__":
    try:
        eingabe = json.load(sys.stdin)
        befehl = sys.argv[1]
        erg = lesen(eingabe) if befehl == "lesen" else schreiben(eingabe)
        json.dump(erg, sys.stdout, ensure_ascii=False)
    except Exception as ex:  # noqa: BLE001 – Fehlertext geht an die App
        json.dump({"fehler": f"{type(ex).__name__}: {ex}"}, sys.stdout, ensure_ascii=False)
        sys.exit(2)

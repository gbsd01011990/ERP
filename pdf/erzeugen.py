# -*- coding: utf-8 -*-
"""
Erzeugt Angebote, Auftragsbestätigungen, Rechnungen und Mengennachweise im CD der jeweiligen Firma.

    python3 erzeugen.py ziel.pdf < beleg.json

Die App (src/lib/pdf.ts) liefert die Daten als JSON auf stdin. Das Blatt selbst
bauen die Generatoren aus den CD-Vorgaben (gbsd/, rd/, kud/) – hier steht nur
die Zuordnung der Felder. Layoutänderungen gehören in die Generatoren.
"""
import json
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))


def eur(v):
    """1234.5 -> '1.234,50'"""
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def menge_txt(v):
    s = f"{v:,.3f}".rstrip("0").rstrip(".")
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def absaetze(s):
    return [a.strip() for a in (s or "").split("\n\n") if a.strip()]


# --------------------------------------------------------------------- GBSD
def gbsd(d, ziel):
    sys.path.insert(0, os.path.join(HIER, "gbsd"))
    from gbsd_dokument import GBSDDokument, SPALTEN_PREISE, SPALTEN_MENGEN

    infos = [(d.get("belegLabel") or f"{d['dokumentart']} Nr.:", d["belegnummer"], True), ("Datum:", d["datum"])]
    if d.get("kundennummer"):
        infos.append(("Kunden-Nr.:", d["kundennummer"]))
    if d.get("gueltigBis"):
        infos.append(("Gültig bis:", d["gueltigBis"]))
    if d.get("ansprechpartner"):
        infos.append(("Ansprechpartner:", d["ansprechpartner"]))
    for label, wert in d.get("infosZusatz") or []:
        infos.append((f"{label}:", wert))

    doc = GBSDDokument(ziel, empfaenger=d["empfaenger"], infos=infos)
    doc.betreff(d["betreff"])
    if d.get("anrede"):
        doc.absatz(d["anrede"], abstand=0)
    for a in absaetze(d.get("einleitung")):
        doc.absatz(a, abstand=0)
    for a in absaetze(d.get("vorbemerkung")):
        doc.absatz(a)

    zeilen = []
    for p in d["positionen"]:
        if p["art"] == "GRUPPE":
            zeilen.append({"pos": p["posNr"], "text": p["kurztext"], "beschreibung": p.get("langtext") or ""})
        elif p["art"] == "TEXT":
            zeilen.append({"text": p["kurztext"], "beschreibung": p.get("langtext") or ""})
        else:
            besch = p.get("langtext") or ""
            if p.get("bedarf"):
                besch = (besch + "\n" if besch else "") + "Bedarfsposition – nicht in der Summe enthalten."
            zeilen.append({
                "pos": p["posNr"], "text": p["kurztext"], "beschreibung": besch,
                "menge": menge_txt(p["menge"]), "einheit": p["einheit"],
                "preis": eur(p["einzelpreis"]), "gesamt": "" if p.get("bedarf") else eur(p["gesamt"]),
            })
    if d.get("mengennachweis"):
        doc.tabelle(SPALTEN_MENGEN, _mengen_zeilen(d))
        doc.speichern()
        return
    doc.tabelle(SPALTEN_PREISE, zeilen)
    re_ = d.get("rechnung")
    if re_:
        doc.summen([(z["label"], f"{eur(z['betrag'])} €") for z in re_["abrechnung"]])
        if re_.get("vorrechnungen"):
            doc.abschnitt(re_.get("vorrechnungenTitel") or "Verrechnete Rechnungen", re_["vorrechnungen"])
        for h in re_.get("hinweise") or []:
            doc.hinweis(h["titel"], h["text"])
        if re_.get("zahlung"):
            doc.absatz(re_["zahlung"])
        for a in absaetze(d.get("schlusstext")):
            doc.absatz(a)
        doc.gruss(name=d.get("unterzeichner") or None)
        doc.speichern()
        return
    s = d["summen"]
    doc.summen([
        ("Summe netto", f"{eur(s['netto'])} €"),
        (f"zzgl. {menge_txt(s['mwstSatz'])} % USt.", f"{eur(s['mwst'])} €"),
        ("Gesamtbetrag brutto", f"{eur(s['brutto'])} €"),
    ])
    if s.get("lohnanteilBrutto"):
        doc.hinweis("Steuerermäßigung nach § 35a EStG",
                    f"Im Gesamtbetrag sind Lohnkosten von {eur(s['lohnanteilBrutto'])} € brutto enthalten. "
                    "Den genauen Betrag weisen wir in der Rechnung aus.")
    for a in absaetze(d.get("schlusstext")):
        doc.absatz(a)
    doc.gruss(name=d.get("unterzeichner") or None)
    doc.speichern()


def _mengen_zeilen(d):
    """Mengennachweis (REB): je Position die Aufmaßzeilen als Beschreibung."""
    zeilen = []
    for p in d["positionen"]:
        if p["art"] == "GRUPPE":
            zeilen.append({"pos": p["posNr"], "text": p["kurztext"], "beschreibung": ""})
        elif p["art"] == "POSITION":
            zeilen.append({"pos": p["posNr"], "text": p["kurztext"], "beschreibung": "\n".join(p.get("aufmass") or []),
                           "menge": menge_txt(p["menge"]), "einheit": p["einheit"]})
    return zeilen


def _rechnung_rd_kud(doc, mod, d, luecke=17.0):
    """Abzüge, Einbehalt und Zahlbetrag unter der Zusammenstellung; danach Hinweise und Zahlungstext."""
    re_ = d["rechnung"]
    c = doc.c
    # Netto, Steuer und Summe zeigt die Zusammenstellung; Mahnungen geben ihre Zeilen ausdrücklich vor
    weitere = re_["weitere"] if "weitere" in re_ else re_["abrechnung"][3:]
    if weitere:
        doc.y -= luecke
        for i, z in enumerate(weitere):
            doc._platz(mod.ZEILE)
            fett = i == len(weitere) - 1
            mod.text(c, mod.POS_X, doc.y, z["label"], 10.0, fett=fett)
            mod.text(c, mod.ZUSAMMEN_R, doc.y, mod.zahl(z["betrag"]), 10.0, fett=fett, align="right")
            doc.y -= 14.46
    doc._in_tabelle = False
    doc.y -= mod.ABSATZ
    if re_.get("vorrechnungen"):
        doc.absatz(re_.get("vorrechnungenTitel") or "Verrechnete Rechnungen", fett=True, abstand=mod.ZEILE)
        for v in re_["vorrechnungen"]:
            doc.absatz(v, abstand=mod.ZEILE)
        doc.y -= mod.ABSATZ - mod.ZEILE
    for h in re_.get("hinweise") or []:
        doc.absatz(h["titel"], fett=True, abstand=mod.ZEILE)
        doc.absatz(h["text"])
    if re_.get("zahlung"):
        doc.absatz(re_["zahlung"])
    for a in absaetze(d.get("schlusstext")):
        doc.absatz(a)


def _mengen_rd_kud(doc, mod, d):
    for p in d["positionen"]:
        if p["art"] == "GRUPPE":
            doc.absatz(f"{p['posNr']}  {p['kurztext']}", fett=True, abstand=mod.ZEILE)
        elif p["art"] == "POSITION":
            doc.absatz(f"{p['posNr']}  {p['kurztext']}: {menge_txt(p['menge'])} {p['einheit']}", fett=True, abstand=mod.ZEILE)
            for z in p.get("aufmass") or []:
                doc.absatz(z, x=mod.TEXT_X, abstand=mod.ZEILE)
            doc.y -= 6


# ------------------------------------------------- Riedrich und Dremel (GvE)
def _tabellarisch(doc, d, umbrechen_fn=None):
    """Gemeinsamer Positionsteil für die Generatoren von RD und KUD."""
    offen = False
    for p in d["positionen"]:
        if p["art"] == "GRUPPE":
            if offen:
                doc.gruppensumme()
            doc.hauptposition(p["posNr"], p["kurztext"])
            offen = True
            continue
        if not offen:
            doc.hauptposition("01", "Leistungen")
            offen = True
        besch = []
        for teil in (p.get("langtext") or "").split("\n"):
            if teil.strip():
                besch.extend(umbrechen_fn(teil) if umbrechen_fn else [teil])
        if p["art"] == "TEXT":
            doc.position("", p["kurztext"], beschreibung=besch or None)
            continue
        if p.get("bedarf"):
            besch.append("Bedarfsposition, nicht in der Summe enthalten.")
            doc.position(p["posNr"], p["kurztext"], beschreibung=besch, menge=p["menge"],
                         einheit=p["einheit"], einzelpreis=p["einzelpreis"], gesamt=0.0)
        else:
            doc.position(p["posNr"], p["kurztext"], beschreibung=besch or None, menge=p["menge"],
                         einheit=p["einheit"], einzelpreis=p["einzelpreis"], gesamt=p["gesamt"])
    if offen:
        doc.gruppensumme()


def rd(d, ziel):
    sys.path.insert(0, os.path.join(HIER, "rd", "dokument"))
    from gve_dokument import GvEDokument

    doc = GvEDokument(ziel, dokumentart=d["dokumentart"], belegnummer=d["belegnummer"],
                      empfaenger=d["empfaenger"], kundennummer=d.get("kundennummer") or "",
                      ansprechpartner=d.get("ansprechpartner") or "", datum=d["datum"],
                      betreff=d["betreff"], mwst=d["summen"]["mwstSatz"])
    if d.get("anrede"):
        doc.anrede(d["anrede"])
    for a in absaetze(d.get("einleitung")):
        doc.absatz(a, max_breite=430.0)
    if d.get("vorbemerkung"):
        doc.vorbemerkung(absaetze(d["vorbemerkung"]))
    import gve_dokument as mod
    for zeile in d.get("vortext") or []:
        doc.absatz(zeile, max_breite=430.0)
    if d.get("mengennachweis"):
        _mengen_rd_kud(doc, mod, d)
        doc.speichern()
        return
    doc.tabelle()
    _tabellarisch(doc, d)
    doc.zusammenstellung()
    if d.get("rechnung"):
        _rechnung_rd_kud(doc, mod, d)
        doc.schluss(satz=None, unterzeichner=d.get("unterzeichner") or None)
        doc.speichern()
        return
    doc.schluss(unterzeichner=d.get("unterzeichner") or None)
    if d["dokumentart"] == "Angebot":
        doc.auftragsformular()
        if d.get("verbraucher"):
            doc.widerrufsbelehrung()
    doc.speichern()


# ----------------------------------------------------------- Kusche und Dremel
def _ohne_eurozeichen(x):
    """Die KuD-Hausschrift hat kein €-Zeichen: überall „EUR“ schreiben."""
    if isinstance(x, str):
        return x.replace(" €", " EUR").replace("€", "EUR")
    if isinstance(x, list):
        return [_ohne_eurozeichen(v) for v in x]
    if isinstance(x, dict):
        return {k: _ohne_eurozeichen(v) for k, v in x.items()}
    return x


def kud(d, ziel):
    d = _ohne_eurozeichen(d)
    sys.path.insert(0, os.path.join(HIER, "kud"))
    from reportlab.lib.utils import simpleSplit
    from kud_dokument import KuDDokument, TEXT_X, EP_R
    import kud_cd

    breite = EP_R - 60 - TEXT_X
    umbrechen = lambda s: simpleSplit(s, kud_cd.SCHRIFT, 10.0, breite)  # noqa: E731

    doc = KuDDokument(ziel, dokumentart=d["dokumentart"], belegnummer=d["belegnummer"],
                      empfaenger=d["empfaenger"], kundennummer=d.get("kundennummer") or "",
                      ansprechpartner=d.get("ansprechpartner") or "", datum=d["datum"],
                      betreff=d["betreff"], mwst=d["summen"]["mwstSatz"])
    if d.get("anrede"):
        doc.anrede(d["anrede"])
    for a in absaetze(d.get("einleitung")):
        doc.absatz(a)
    if d.get("vorbemerkung"):
        doc.vorbemerkung(absaetze(d["vorbemerkung"]))
    import kud_dokument as mod
    for zeile in d.get("vortext") or []:
        doc.absatz(zeile)
    if d.get("mengennachweis"):
        _mengen_rd_kud(doc, mod, d)
        doc.speichern()
        return
    doc.tabelle()
    # Titel bricht der KuD-Generator nicht um: lange Kurztexte in die Beschreibung verschieben.
    for p in d["positionen"]:
        zeilen = umbrechen(p["kurztext"])
        if len(zeilen) > 1:
            p["kurztext"] = zeilen[0]
            p["langtext"] = " ".join(zeilen[1:]) + ("\n" + p["langtext"] if p.get("langtext") else "")
    _tabellarisch(doc, d, umbrechen)
    doc.zusammenstellung()
    if d.get("rechnung"):
        _rechnung_rd_kud(doc, mod, d, luecke=-26.0)  # KuD lässt nach der Endsumme schon Platz
        doc.schluss(satz=None, unterzeichner=d.get("unterzeichner") or "")
        doc.speichern()
        return
    doc.schluss(unterzeichner=d.get("unterzeichner") or "")
    if d["dokumentart"] == "Angebot":
        doc.auftragsformular()
        if d.get("verbraucher"):
            doc.widerrufsbelehrung()
    doc.speichern()


if __name__ == "__main__":
    daten = json.load(sys.stdin)
    {"GBSD": gbsd, "RD": rd, "KUD": kud}[daten["firma"]](daten, sys.argv[1])
    print(sys.argv[1])

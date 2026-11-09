# -*- coding: utf-8 -*-
"""
Kontoauszug im Format CAMT.053 (ISO 20022, Version 001.02 bis 001.13) lesen.

    python3 camt.py < auszug.xml   → JSON-Liste der Umsätze

Je Umsatz: referenz, buchungstag (JJJJ-MM-TT), betrag (Eingang positiv, Ausgang negativ),
name (Gegenpartei), iban, verwendungszweck. Sammelbuchungen mit mehreren Einzelumsätzen
(TxDtls mit eigenem Betrag) werden aufgeteilt. Nur Standardbibliothek.
"""
import hashlib
import json
import sys
import xml.etree.ElementTree as ET


def lokal(tag):
    return tag.rsplit("}", 1)[-1]


def finde(el, pfad):
    """Pfad aus lokalen Namen ohne Namensraum, z. B. 'Amt' oder 'BookgDt/Dt'."""
    aktuell = [el]
    for teil in pfad.split("/"):
        naechste = []
        for a in aktuell:
            naechste.extend(k for k in a if lokal(k.tag) == teil)
        aktuell = naechste
        if not aktuell:
            return None
    return aktuell[0]


def text(el, pfad):
    x = finde(el, pfad) if el is not None else None
    return x.text.strip() if x is not None and x.text else None


def alle(el, name):
    return [k for k in el.iter() if lokal(k.tag) == name]


def lesen(xml):
    wurzel = ET.fromstring(xml)
    raus = []
    for stmt in alle(wurzel, "Stmt"):
        eigene_iban = text(stmt, "Acct/Id/IBAN")
        for ntry in [k for k in stmt if lokal(k.tag) == "Ntry"]:
            status = text(ntry, "Sts/Cd") or text(ntry, "Sts")
            if status not in (None, "BOOK"):
                continue  # vorgemerkte Umsätze (PDNG, INFO) überspringen
            soll = text(ntry, "CdtDbtInd") == "DBIT"
            tag = text(ntry, "BookgDt/Dt") or (text(ntry, "BookgDt/DtTm") or "")[:10] or text(ntry, "ValDt/Dt")
            gesamt = float(text(ntry, "Amt") or 0)
            ref_eintrag = text(ntry, "AcctSvcrRef") or text(ntry, "NtryRef")
            details = alle(ntry, "TxDtls")
            if not details:
                details = [None]
            for i, tx in enumerate(details):
                quelle = tx if tx is not None else ntry
                betrag = gesamt
                if tx is not None and len(details) > 1:
                    betrag = float(text(tx, "AmtDtls/TxAmt/Amt") or text(tx, "Amt") or 0)
                # Gegenpartei: bei Eingang der Zahler (Dbtr), bei Ausgang der Empfänger (Cdtr)
                rolle = "Cdtr" if soll else "Dbtr"
                name = (text(quelle, f"RltdPties/{rolle}/Nm") or text(quelle, f"RltdPties/{rolle}/Pty/Nm")
                        or text(quelle, f"RltdPties/Ultmt{rolle}/Nm"))
                iban = text(quelle, f"RltdPties/{rolle}Acct/Id/IBAN")
                zweck = " ".join(x.text.strip() for x in alle(quelle, "Ustrd") if x.text)
                if not zweck:
                    zweck = text(ntry, "AddtlNtryInf") or ""
                e2e = text(quelle, "Refs/EndToEndId")
                ref = text(quelle, "Refs/AcctSvcrRef") or ref_eintrag
                if not ref:
                    roh = f"{eigene_iban}|{tag}|{betrag}|{iban}|{zweck}|{e2e}|{i}"
                    ref = "h" + hashlib.sha256(roh.encode()).hexdigest()[:32]
                elif len(details) > 1:
                    ref = f"{ref}#{i}"
                raus.append({
                    "referenz": ref, "buchungstag": tag, "betrag": round(-betrag if soll else betrag, 2),
                    "name": name, "iban": iban, "verwendungszweck": zweck.strip() or None,
                })
    return raus


if __name__ == "__main__":
    try:
        print(json.dumps(lesen(sys.stdin.buffer.read()), ensure_ascii=False))
    except ET.ParseError as e:
        print(json.dumps({"fehler": f"Keine gültige XML-Datei: {e}"}))

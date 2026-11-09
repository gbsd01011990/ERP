/**
 * E-Rechnung im Format UN/CEFACT CII (Cross Industry Invoice) nach EN 16931.
 * - Profil "XRECHNUNG": XRechnung 3.0 (zusätzliche deutsche Regeln BR-DE-*)
 * - Profil "EN16931": für ZUGFeRD/Factur-X, eingebettet ins Rechnungs-PDF
 *
 * Abschläge und Teilschlussrechnungen stehen als TotalPrepaidAmount (BT-113) in der Rechnung:
 * Positionen und Umsatzsteuer zeigen die Gesamtleistung, der Zahlbetrag (BT-115) den Rest.
 * Storno und Rechnungskorrektur mit negativem Betrag werden Gutschriften (381) mit
 * umgedrehten Vorzeichen. Reine Funktion ohne Datenbank.
 */
import type { Verkaeufer } from "./stammdaten";
import type { Berechnung } from "./berechnung";
import { berlinTag } from "../zeit";

export type CiiProfil = "XRECHNUNG" | "EN16931";

export type CiiKaeufer = {
  name: string; strasse: string | null; plz: string | null; ort: string | null; land: string;
  email: string | null; ustId: string | null; kundennummer: string | null; kontaktperson: string | null;
};

export type CiiPosition = { art: string; posNr: string; kurztext: string; langtext: string | null; menge: number; einheit: string; einzelpreis: number; gesamt: number };

export type CiiRechnung = {
  nummer: string; art: "RECHNUNG" | "ABSCHLAG" | "TEILSCHLUSS" | "SCHLUSS" | "KORREKTUR" | "STORNO";
  datum: Date; leistungVon: Date | null; leistungBis: Date | null;
  kundenReferenz: string | null; steuerschuldUmkehr: boolean; zahlungszielTage: number;
  skontoProzent: number; skontoTage: number; einbehaltProzent: number;
  bezug: { nummer: string; datum: Date } | null;
  hinweise: string[];
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const betrag = (v: number) => (Math.round(v * 100) / 100 + 0).toFixed(2);
const menge = (v: number) => String(Math.round(v * 10000) / 10000 + 0);
const tag102 = (d: Date) => berlinTag(d).replace(/-/g, "");
const datum = (d: Date) => `<udt:DateTimeString format="102">${tag102(d)}</udt:DateTimeString>`;
const el = (name: string, inhalt: string | null | undefined, attr = "") => (inhalt == null || inhalt === "" ? "" : `<ram:${name}${attr}>${inhalt}</ram:${name}>`);
const txt = (name: string, s: string | null | undefined, attr = "") => el(name, s == null || s.trim() === "" ? null : esc(s.trim()), attr);

/** UN/ECE Empfehlung 20 */
export function einheitCode(e: string) {
  const s = e.trim().toLowerCase().replace(/\.$/, "");
  const tabelle: Record<string, string> = {
    stk: "H87", "stück": "H87", st: "H87", stck: "H87", pcs: "H87",
    "m²": "MTK", m2: "MTK", qm: "MTK", "m³": "MTQ", m3: "MTQ", cbm: "MTQ",
    m: "MTR", lfm: "MTR", lfdm: "MTR", "lfd. m": "MTR", km: "KMT",
    h: "HUR", std: "HUR", stunde: "HUR", stunden: "HUR", min: "MIN",
    psch: "LS", pauschal: "LS", pausch: "LS", pa: "LS",
    kg: "KGM", t: "TNE", to: "TNE", l: "LTR", ltr: "LTR",
    tag: "DAY", tage: "DAY", d: "DAY", woche: "WEE", monat: "MON", satz: "SET",
  };
  return tabelle[s] ?? "C62";
}

const TYPCODE = { RECHNUNG: "380", ABSCHLAG: "875", TEILSCHLUSS: "876", SCHLUSS: "877", KORREKTUR: "384", STORNO: "381" } as const;

/** Was fehlt für eine gültige XRechnung? Leere Liste = vollständig. */
export function xrechnungMaengel(v: Verkaeufer, k: CiiKaeufer, r: CiiRechnung) {
  const m: string[] = [];
  if (!k.email) m.push("E-Mail-Adresse des Kunden (elektronische Adresse BT-49)");
  if (!k.strasse || !k.plz || !k.ort) m.push("vollständige Anschrift des Kunden");
  if (r.steuerschuldUmkehr && !k.ustId) m.push("USt-IdNr. des Kunden (Pflicht bei § 13b)");
  if (!v.iban) m.push("IBAN der Firma");
  return m;
}

export function ciiErzeugen(o: {
  profil: CiiProfil; verkaeufer: Verkaeufer; kaeufer: CiiKaeufer; rechnung: CiiRechnung;
  positionen: CiiPosition[]; berechnung: Berechnung;
}) {
  const { verkaeufer: v, kaeufer: k, rechnung: r, berechnung: be } = o;
  // Gutschrift: Storno und negative Korrektur mit umgedrehtem Vorzeichen
  const gutschrift = r.art === "STORNO" || (r.art === "KORREKTUR" && be.leistung.brutto < 0);
  const f = gutschrift ? -1 : 1;
  const typ = gutschrift ? "381" : TYPCODE[r.art];
  const satz = be.mwstSatz;
  const kategorie = r.steuerschuldUmkehr ? "AE" : satz > 0 ? "S" : "E";

  const zeilen = o.positionen.filter((p) => p.art === "POSITION").map((p, i) => {
    const m = p.menge * f;
    // Negative Preise sind nicht erlaubt (BR-27): Vorzeichen in die Menge
    const ep = Math.abs(p.einzelpreis);
    const mengeMitVorzeichen = p.einzelpreis < 0 ? -m : m;
    return `<ram:IncludedSupplyChainTradeLineItem>
<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct>${txt("SellerAssignedID", p.posNr)}${txt("Name", p.kurztext)}${txt("Description", p.langtext)}</ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${betrag(ep)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${einheitCode(p.einheit)}">${menge(mengeMitVorzeichen)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${kategorie}</ram:CategoryCode><ram:RateApplicablePercent>${betrag(satz)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${betrag(p.gesamt * f)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>`;
  });

  const netto = be.leistung.netto * f, mwst = be.leistung.mwst * f, brutto = be.leistung.brutto * f;
  const vorab = be.abzug.brutto * f, faellig = be.brutto * f;

  const notizen = [...r.hinweise];
  if (be.einbehalt) notizen.push(`Sicherheitseinbehalt ${String(r.einbehaltProzent).replace(".", ",")} %: ${betrag(be.einbehalt).replace(".", ",")} EUR; zu überweisen sind ${betrag(be.zahlbetrag).replace(".", ",")} EUR.`);
  if (be.einbehaltFreigabe) notizen.push(`Einbehalte aus verrechneten Abschlagsrechnungen werden fällig: ${betrag(be.einbehaltFreigabe).replace(".", ",")} EUR.`);

  const zahlungsTage = r.zahlungszielTage;
  const faelligAm = new Date(r.datum.getTime() + zahlungsTage * 864e5);
  let bedingungen = faellig > 0 ? (zahlungsTage === 0 ? "Zahlbar sofort ohne Abzug." : `Zahlbar bis ${berlinTag(faelligAm).split("-").reverse().join(".")} ohne Abzug.`) : "Der Betrag wird erstattet.";
  // XRechnung (BR-DE-18): Skonto maschinenlesbar, die Zeile endet mit einem Zeilenumbruch
  if (faellig > 0 && r.skontoProzent > 0 && r.skontoTage > 0) bedingungen += `\n#SKONTO#TAGE=${r.skontoTage}#PROZENT=${r.skontoProzent.toFixed(2)}#\n`;

  const zeitraum = r.leistungVon && r.leistungBis && tag102(r.leistungVon) !== tag102(r.leistungBis);
  const einTag = r.leistungBis ?? r.leistungVon;
  const kontaktVerk = `<ram:DefinedTradeContact>${txt("PersonName", v.kontakt)}<ram:TelephoneUniversalCommunication>${txt("CompleteNumber", v.telefon)}</ram:TelephoneUniversalCommunication><ram:EmailURIUniversalCommunication>${txt("URIID", v.email)}</ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>
${o.profil === "XRECHNUNG" ? "<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>" : ""}
<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${o.profil === "XRECHNUNG" ? "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0" : "urn:cen.eu:en16931:2017"}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
</rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
<ram:ID>${esc(r.nummer)}</ram:ID>
<ram:TypeCode>${typ}</ram:TypeCode>
<ram:IssueDateTime>${datum(r.datum)}</ram:IssueDateTime>
${notizen.map((n) => `<ram:IncludedNote><ram:Content>${esc(n)}</ram:Content></ram:IncludedNote>`).join("\n")}
<ram:IncludedNote><ram:Content>${esc(v.rechtliches)}</ram:Content><ram:SubjectCode>REG</ram:SubjectCode></ram:IncludedNote>
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${zeilen.join("\n")}
<ram:ApplicableHeaderTradeAgreement>
${txt("BuyerReference", r.kundenReferenz ?? k.kundennummer ?? r.nummer)}
<ram:SellerTradeParty>
${txt("Name", v.name)}
${txt("Description", v.rechtliches)}
${kontaktVerk}
<ram:PostalTradeAddress>${txt("PostcodeCode", v.plz)}${txt("LineOne", v.strasse)}${txt("CityName", v.ort)}<ram:CountryID>${v.land}</ram:CountryID></ram:PostalTradeAddress>
<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(v.email)}</ram:URIID></ram:URIUniversalCommunication>
<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(v.ustId)}</ram:ID></ram:SpecifiedTaxRegistration>
</ram:SellerTradeParty>
<ram:BuyerTradeParty>
${txt("ID", k.kundennummer)}
${txt("Name", k.name)}
${k.kontaktperson ? `<ram:DefinedTradeContact>${txt("PersonName", k.kontaktperson)}</ram:DefinedTradeContact>` : ""}
<ram:PostalTradeAddress>${txt("PostcodeCode", k.plz)}${txt("LineOne", k.strasse)}${txt("CityName", k.ort)}<ram:CountryID>${esc(k.land || "DE")}</ram:CountryID></ram:PostalTradeAddress>
${k.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(k.email)}</ram:URIID></ram:URIUniversalCommunication>` : ""}
${k.ustId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(k.ustId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}
</ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>${einTag && !zeitraum ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${datum(einTag)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : ""}</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
${txt("PaymentReference", r.nummer)}
<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(v.iban)}</ram:IBANID>${txt("AccountName", v.name)}</ram:PayeePartyCreditorFinancialAccount>${v.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(v.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ""}</ram:SpecifiedTradeSettlementPaymentMeans>
<ram:ApplicableTradeTax><ram:CalculatedAmount>${betrag(mwst)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${kategorie === "AE" ? "<ram:ExemptionReason>Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)</ram:ExemptionReason>" : kategorie === "E" ? "<ram:ExemptionReason>Steuerbefreite Leistung</ram:ExemptionReason>" : ""}<ram:BasisAmount>${betrag(netto)}</ram:BasisAmount><ram:CategoryCode>${kategorie}</ram:CategoryCode>${kategorie === "AE" ? "<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>" : ""}<ram:RateApplicablePercent>${betrag(satz)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
${zeitraum ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime>${datum(r.leistungVon!)}</ram:StartDateTime><ram:EndDateTime>${datum(r.leistungBis!)}</ram:EndDateTime></ram:BillingSpecifiedPeriod>` : ""}
<ram:SpecifiedTradePaymentTerms>${el("Description", esc(bedingungen))}${faellig > 0 && zahlungsTage > 0 ? `<ram:DueDateDateTime>${datum(faelligAm)}</ram:DueDateDateTime>` : ""}</ram:SpecifiedTradePaymentTerms>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
<ram:LineTotalAmount>${betrag(netto)}</ram:LineTotalAmount>
<ram:TaxBasisTotalAmount>${betrag(netto)}</ram:TaxBasisTotalAmount>
<ram:TaxTotalAmount currencyID="EUR">${betrag(mwst)}</ram:TaxTotalAmount>
<ram:GrandTotalAmount>${betrag(brutto)}</ram:GrandTotalAmount>
${vorab ? `<ram:TotalPrepaidAmount>${betrag(vorab)}</ram:TotalPrepaidAmount>` : ""}
<ram:DuePayableAmount>${betrag(faellig)}</ram:DuePayableAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${r.bezug ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(r.bezug.nummer)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${tag102(r.bezug.datum)}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>` : ""}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`.replace(/\n\s*\n/g, "\n");
}

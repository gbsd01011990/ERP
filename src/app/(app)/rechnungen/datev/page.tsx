import Link from "next/link";
import { benutzerPflicht } from "@/lib/auth";
import { buchhaltungLaden } from "@/lib/dienste/zahlungen";
import { berlinTag, tagPlus } from "@/lib/zeit";
import { RechnungenNav } from "@/components/rechnungen-nav";

export default async function Datev() {
  const b = await benutzerPflicht(["ADMIN", "BUERO"]);
  const bh = await buchhaltungLaden(b.mandant.id);
  const heute = berlinTag(new Date());
  const vormonatEnde = tagPlus(`${heute.slice(0, 7)}-01`, -1);
  const vormonatAnfang = `${vormonatEnde.slice(0, 7)}-01`;
  return (
    <div className="space-y-4">
      <h1 className="h1">DATEV-Export für die Kanzlei</h1>
      <RechnungenNav aktiv="/rechnungen/datev" />
      <section className="karte max-w-3xl space-y-3 text-sm">
        <p className="text-slate-600">
          Das ZIP enthält den Buchungsstapel im DATEV-Format (EXTF, SKR03) mit allen festgeschriebenen Rechnungen und den
          Zahlungseingängen im Zeitraum, eine Debitorenliste und die Rechnungs-PDFs als Belege. Die Kanzlei liest den Stapel in
          DATEV Kanzlei-Rechnungswesen ein. Debitorennummern vergibt das ERP beim ersten Export ab {bh.debitorStart}; sie bleiben danach gleich.
        </p>
        {!bh.beraterNr || !bh.mandantNr ? (
          <p className="text-amber-800">Bitte zuerst unter <Link href="/einstellungen/buchhaltung" className="text-marke">Einstellungen → Buchhaltung</Link> die Berater- und Mandantennummer der Kanzlei eintragen.</p>
        ) : (
          <form action="/rechnungen/datev/export" method="get" className="flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="von">von</label><input id="von" type="date" name="von" defaultValue={vormonatAnfang} className="eingabe" /></div>
            <div><label className="label" htmlFor="bis">bis</label><input id="bis" type="date" name="bis" defaultValue={vormonatEnde} className="eingabe" /></div>
            <button className="btn">ZIP herunterladen</button>
          </form>
        )}
        <p className="text-xs text-slate-500">Konten: Erlöse 19 % {bh.kontoErloese19}, 7 % {bh.kontoErloese7}, § 13b {bh.kontoErloese13b}, Skonto {bh.kontoSkonto}, Bank {bh.kontoBank}, Kasse {bh.kontoKasse}. Bitte vor dem ersten Export mit der Kanzlei abstimmen.</p>
      </section>
    </div>
  );
}

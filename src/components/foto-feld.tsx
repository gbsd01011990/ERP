"use client";
import { useEffect, useRef, useState } from "react";

const MAX_KANTE = 2000;

/** Foto im Browser verkleinern (JPEG). Spart Upload-Zeit im Funkloch und Speicher. HEIC und PDF bleiben unverändert. */
async function verkleinern(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return f;
  try {
    const bild = await createImageBitmap(f);
    const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height));
    if (faktor === 1 && f.size < 1_500_000) return f;
    const c = document.createElement("canvas");
    c.width = Math.round(bild.width * faktor); c.height = Math.round(bild.height * faktor);
    c.getContext("2d")!.drawImage(bild, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : f;
  } catch {
    return f;
  }
}

/**
 * Fotos (Kamera) oder Dateien (PDF, Bilder) sammeln und als ein Feld `name` mitschicken.
 * Am Handy öffnet „Foto aufnehmen“ direkt die Kamera; mehrere Seiten nacheinander sind möglich.
 */
export function FotoFeld({ name = "datei", pflicht = false }: { name?: string; pflicht?: boolean }) {
  const [dateien, setDateien] = useState<File[]>([]);
  const [arbeitet, setArbeitet] = useState(false);
  const feld = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    if (!feld.current) return;
    const dt = new DataTransfer();
    dateien.forEach((f) => dt.items.add(f));
    feld.current.files = dt.files;
  }, [dateien]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  // Solange verkleinert wird, darf das Formular nicht abschicken (sonst fehlt das Foto)
  useEffect(() => {
    const form = feld.current?.closest("form");
    if (!form) return;
    if (arbeitet) form.dataset.beschaeftigt = "1"; else delete form.dataset.beschaeftigt;
  }, [arbeitet]);

  const dazu = async (liste: FileList | null) => {
    if (!liste?.length) return;
    setArbeitet(true);
    const neu = await Promise.all([...liste].map(verkleinern));
    setDateien((d) => [...d, ...neu].slice(0, 10));
    setArbeitet(false);
  };
  const vorschau = (f: File) => {
    if (!f.type.startsWith("image/") || f.type === "image/heic") return null;
    const u = URL.createObjectURL(f);
    urls.current.push(u);
    return u;
  };

  return (
    <div className="space-y-2">
      {/* Pflicht prüft der Server: ein verstecktes Pflichtfeld würde das Absenden stumm blockieren */}
      <input ref={feld} type="file" name={name} multiple hidden data-pflicht={pflicht ? "1" : undefined} />
      <div className="flex flex-wrap gap-2">
        <label className="btn cursor-pointer">
          📷 Foto aufnehmen
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { dazu(e.target.files); e.target.value = ""; }} />
        </label>
        <label className="btn-hell cursor-pointer">
          Datei wählen (Foto, PDF)
          <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { dazu(e.target.files); e.target.value = ""; }} />
        </label>
        {arbeitet && <span role="status" className="self-center text-sm text-amber-700">Foto wird vorbereitet – bitte kurz warten …</span>}
      </div>
      {dateien.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {dateien.map((f, i) => {
            const u = vorschau(f);
            return (
              <li key={`${f.name}-${i}`} className="relative rounded border border-slate-200 bg-white p-1 text-xs">
                {u ? <img src={u} alt={f.name} className="h-24 w-24 object-cover" /> : <div className="flex h-24 w-24 items-center justify-center text-center">{f.type === "application/pdf" ? "PDF" : "Foto"}<br />{f.name.slice(0, 14)}</div>}
                <span className="block text-center text-slate-500">{Math.round(f.size / 1024)} KB</span>
                <button type="button" aria-label="entfernen" onClick={() => setDateien((d) => d.filter((_, j) => j !== i))} className="absolute right-0 top-0 rounded-bl bg-white/90 px-1 text-red-600">✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

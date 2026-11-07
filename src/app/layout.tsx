import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "ERP", description: "Betriebssoftware GBSD · Riedrich und Dremel · Kusche und Dremel" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-slate-50 text-slate-800 antialiased">{children}</body>
    </html>
  );
}

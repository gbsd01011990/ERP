import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  experimental: {
    // Standard sind 1 MB – zu wenig für PDF-Rechnungen, GAEB-Dateien, Kontoauszüge und Lieferscheinfotos
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default config;

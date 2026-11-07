import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default config;

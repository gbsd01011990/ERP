import { PrismaClient } from "@prisma/client";

// Große Binärfelder nicht standardmäßig laden (GAEB-Originaldatei); wo nötig mit omit: { gaebQuelle: false }
const neu = () => new PrismaClient({ omit: { angebot: { gaebQuelle: true } } });
const g = globalThis as unknown as { prisma?: ReturnType<typeof neu> };
export const db = g.prisma ?? neu();
if (process.env.NODE_ENV !== "production") g.prisma = db;

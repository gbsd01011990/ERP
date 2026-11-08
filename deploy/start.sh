#!/bin/sh
# Start im Container: Datenbankschema abgleichen, Grunddaten sicherstellen, App starten.
set -e
npx prisma db push --skip-generate
npx tsx prisma/seed.ts
exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"

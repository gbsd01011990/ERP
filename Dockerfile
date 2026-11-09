# ERP – Produktions-Image: Next.js, Prisma, Python-PDF-Generatoren
#
# Basis ist das offizielle Python-Image; Node kommt aus dem offiziellen Node-Image.
# So braucht der Bau keine Debian-Paketquellen, nur Docker Hub, npm und PyPI.
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm AS basis
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && pip install --no-cache-dir reportlab==5.0.1 pyGAEB==1.21.0 \
    factur-x==7.9 pypdf==6.17.0 lxml==6.1.3 iso4217==1.16.20260101 python-stdnum==2.2 requests==2.34.2
WORKDIR /app

FROM basis AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM basis AS laufzeit
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app /app
# Entwicklungsabhängigkeiten bleiben drin: Prisma-CLI und tsx brauchen wir beim Start
# für den Schema-Abgleich und die Grunddaten.
RUN chmod +x deploy/start.sh && useradd --system --uid 1001 --home-dir /app erp && chown -R erp /app
USER erp
EXPOSE 3000
CMD ["deploy/start.sh"]

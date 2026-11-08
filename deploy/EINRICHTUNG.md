# ERP auf dem Hetzner-Server einrichten

Einmalig, etwa 20 Minuten. Danach liefert GitHub jede neue Version automatisch aus.

Die App läuft komplett in Docker: App, Datenbank (PostgreSQL), tägliche Sicherung und
optional Caddy für HTTPS. Andere Dienste auf dem Server bleiben unberührt, solange
die Ports 80 und 443 frei sind (siehe Schritt 2).

## 1. Docker prüfen

Per SSH auf den Server und:

```bash
docker compose version
```

Kommt eine Versionsnummer (v2.x), ist alles da. Sonst Docker installieren:

```bash
curl -fsSL https://get.docker.com | sh
```

## 2. Prüfen, ob schon ein Webserver läuft

```bash
sudo ss -tlnp | grep -E ':(80|443) '
```

- **Keine Ausgabe:** Ports sind frei. Der mitgelieferte Caddy übernimmt HTTPS
  (`COMPOSE_PROFILES=caddy` in Schritt 4).
- **nginx, apache, plesk o. Ä. erscheint:** Dort läuft schon etwas. Dann
  `COMPOSE_PROFILES=` leer lassen und im vorhandenen Webserver die neue Domain auf
  `http://127.0.0.1:3000` weiterleiten. Im Zweifel die Ausgabe an Claude geben.

## 3. Domain einrichten

Beim Domain-Anbieter einen DNS-Eintrag anlegen, z. B.:

| Typ | Name | Wert |
|---|---|---|
| A | erp | IP-Adresse des Servers |

Ergibt `erp.baumpflegebund.de` (Domain baumpflegebund.de). Bis der Eintrag wirkt, kann es einige Minuten dauern.

## 4. Verzeichnis und Einstellungen

```bash
sudo mkdir -p /opt/erp/app /opt/erp/backups
sudo chown -R $USER /opt/erp
nano /opt/erp/.env
```

Inhalt aus `deploy/env.beispiel` übernehmen und ausfüllen. Ein sicheres Datenbank-Passwort
erzeugt `openssl rand -hex 32`. Die Datei bleibt auf dem Server und landet nie in GitHub.

```bash
chmod 600 /opt/erp/.env
```

## 5. Zugang für GitHub

Auf dem Server einen eigenen Schlüssel nur für die Auslieferung erzeugen:

```bash
ssh-keygen -t ed25519 -N "" -C "github-erp" -f ~/.ssh/github_erp
cat ~/.ssh/github_erp.pub >> ~/.ssh/authorized_keys
sudo usermod -aG docker $USER
cat ~/.ssh/github_erp        # privaten Schlüssel anzeigen und kopieren
```

In GitHub im Repository **ERP** → *Settings* → *Secrets and variables* → *Actions* →
*New repository secret* anlegen:

| Name | Wert |
|---|---|
| `SSH_HOST` | IP-Adresse des Servers |
| `SSH_USER` | Benutzername auf dem Server |
| `SSH_KEY` | der komplette private Schlüssel inkl. `-----BEGIN` und `-----END` |
| `SSH_PORT` | nur nötig, wenn SSH nicht auf Port 22 läuft |

Danach den privaten Schlüssel auf dem Server löschen: `rm ~/.ssh/github_erp`.

## 6. Firewall

In der Hetzner Cloud Console (Firewalls) bzw. mit `ufw` müssen eingehend offen sein:
22 (SSH), 80 und 443 (Web).

## 7. Erste Auslieferung

In GitHub → *Actions* → *Prüfen und ausliefern* → *Run workflow*. Nach 5–10 Minuten
läuft die App unter `https://erp.…`. Anmeldung mit `ADMIN_EMAIL` und `ADMIN_PASSWORT` aus
der `.env`. Danach das Passwort in der `.env` leeren; es wird nur beim ersten Start gebraucht.

## Betrieb

| Aufgabe | Befehl (in `/opt/erp/app/deploy`) |
|---|---|
| Status | `docker compose --env-file /opt/erp/.env ps` |
| Protokoll | `docker compose --env-file /opt/erp/.env logs -f app` |
| Neustart | `docker compose --env-file /opt/erp/.env restart app` |
| Sicherungen | `ls /opt/erp/backups` (täglich, 30 Tage) |
| Sicherung einspielen | `gunzip -c /opt/erp/backups/DATEI.sql.gz \| docker compose --env-file /opt/erp/.env exec -T db psql -U erp -d erp` |
| HERO-Daten übernehmen | `docker compose --env-file /opt/erp/.env exec app npm run import:hero -- --firma GBSD` |

Die Sicherungen liegen auf demselben Server. Für echte Ausfallsicherheit zusätzlich
`/opt/erp/backups` regelmäßig woanders hin kopieren, z. B. in eine Hetzner Storage Box.

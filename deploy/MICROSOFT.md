# Microsoft 365 anbinden (E-Mail)

Das ERP liest und sendet E-Mails über Microsoft Graph mit einer **App-Berechtigung**: Ein
Microsoft-365-Admin richtet die Verbindung einmal ein, danach weist der ERP-Admin jedem Mitarbeiter
sein Postfach zu und gibt geteilte Postfächer (info@, rechnung@) gezielt frei. Kein Mitarbeiter
muss sich dafür bei Microsoft anmelden.

Haben GBSD, Riedrich und Dremel sowie Kusche und Dremel getrennte Microsoft-365-Konten, wird das
für jeden Mandanten einzeln gemacht. Bei einem gemeinsamen Konto reicht eine App für alle drei.

Zeitbedarf: etwa 20 Minuten. Nötig: ein Konto mit der Rolle *Globaler Administrator* oder
*Anwendungsadministrator* in Microsoft 365.

## 0. Schlüssel auf dem Server (einmalig)

Das ERP speichert das Microsoft-Secret verschlüsselt. Dafür in `/opt/erp/.env` eintragen:

```bash
echo "ERP_SCHLUESSEL=$(openssl rand -hex 32)" >> /opt/erp/.env
```

Diesen Wert nie wieder ändern, sonst lassen sich gespeicherte Secrets nicht mehr lesen. Danach in
GitHub *Actions → Prüfen und ausliefern → Run workflow* starten (oder auf die nächste Auslieferung warten).

## 1. App registrieren

1. https://entra.microsoft.com → *Identität* → *Anwendungen* → *App-Registrierungen* → *Neue Registrierung*
2. Name: `ERP Baumpflegebund`, Kontotyp: *Nur Konten in diesem Organisationsverzeichnis*. Keine Umleitungs-URI.
3. Auf der Übersichtsseite notieren: **Anwendungs-ID (Client)** und **Verzeichnis-ID (Mandant)**.

## 2. Berechtigungen

1. *API-Berechtigungen* → *Berechtigung hinzufügen* → *Microsoft Graph* → **Anwendungsberechtigungen**
2. `Mail.Read` und `Mail.Send` auswählen → *Berechtigungen hinzufügen*
3. **Administratorzustimmung für … erteilen** klicken. Beide Zeilen müssen einen grünen Haken zeigen.

## 3. Geheimer Clientschlüssel

1. *Zertifikate & Geheimnisse* → *Neuer geheimer Clientschlüssel*, Ablauf 24 Monate
2. Den **Wert** sofort kopieren (wird nur einmal angezeigt), nicht die „Geheimnis-ID“.
3. Ablaufdatum in den Kalender eintragen: Vorher einen neuen Schlüssel anlegen und im ERP ersetzen,
   sonst stoppt der Mail-Abruf.

## 4. Zugriff auf eure Postfächer beschränken (dringend empfohlen)

Ohne Einschränkung darf die App jedes Postfach im Microsoft-365-Konto lesen. Mit einer
Zugriffsrichtlinie nur die Postfächer, die das ERP wirklich braucht.

1. Im Microsoft 365 Admin Center eine **E-Mail-aktivierte Sicherheitsgruppe** anlegen,
   z. B. `erp-postfaecher@…`, und als Mitglieder alle Mitarbeiter-Postfächer sowie `info@` und
   `rechnung@` aufnehmen.
2. In der PowerShell (Modul *ExchangeOnlineManagement*):

```powershell
Connect-ExchangeOnline
New-ApplicationAccessPolicy -AppId <Anwendungs-ID> -PolicyScopeGroupId erp-postfaecher@eure-domain.de `
  -AccessRight RestrictAccess -Description "ERP nur für freigegebene Postfächer"
# Prüfen: erlaubt / verweigert
Test-ApplicationAccessPolicy -AppId <Anwendungs-ID> -Identity info@eure-domain.de
Test-ApplicationAccessPolicy -AppId <Anwendungs-ID> -Identity geschaeftsfuehrung@eure-domain.de
```

Neue Mitarbeiter später einfach in die Gruppe aufnehmen. Microsoft stellt diese Richtlinien
schrittweise auf „RBAC for Applications“ um; die Wirkung ist dieselbe.

## 5. Im ERP eintragen

1. Als Admin beim Mandanten anmelden → **Postfächer**
2. Verzeichnis-ID, Anwendungs-ID und Clientschlüssel eintragen → *Prüfen und speichern*
3. **+ Postfach hinzufügen**
   - *Persönlich*: Adresse des Mitarbeiters und den Mitarbeiter wählen
   - *Geteilt*: z. B. `info@…` mit Anzeigename „Info“ und die Mitarbeiter ankreuzen, die es sehen sollen
4. Das ERP prüft beim Speichern, ob es das Postfach lesen darf, und holt die Mails der letzten 30 Tage.
   Danach ruft es alle 2 Minuten ab.

## Wer sieht was

| | Nicht zugeordnete Mails | Mails bei Kontakt/Projekt |
|---|---|---|
| Inhaber eines persönlichen Postfachs | ja | ja |
| Mitarbeiter mit Freigabe für info@ | aus info@ | ja |
| Büro ohne Freigabe | nein | ja |
| Admin ohne Freigabe | nein (verwaltet nur) | ja |
| Kolonne | nur aus eigenem Postfach | nein |

Gespeichert wird der Text der Mail (ohne HTML und ohne Anhänge). Anhänge öffnet „In Outlook öffnen“.

## Fehlerbilder

| Meldung | Ursache |
|---|---|
| `AADSTS7000215: Invalid client secret` | Wert statt Geheimnis-ID kopiert, oder Schlüssel abgelaufen |
| `… keinen Zugriff auf dieses Postfach` | Administratorzustimmung fehlt, oder Postfach nicht in der Gruppe aus Schritt 4 |
| `Postfach nicht gefunden` | Adresse falsch, oder Postfach hat keine Exchange-Lizenz |
| `ERP_SCHLUESSEL fehlt` | Schritt 0 auf dem Server fehlt |

# KI-Telefonagent einrichten (je Firma)

Jede Firma bekommt einen eigenen Agenten mit eigener Nummer, Begrüßung, eigenen Regeln
und eigenem Datenbestand. Diese Schritte also dreimal: GBSD, Riedrich und Dremel, Kusche und Dremel.

## Ablauf eines Anrufs

1. Kunde ruft die bekannte Festnetznummer an. Geht im Büro niemand ran (Nichtmelden, Besetzt,
   außerhalb der Bürozeiten), leitet die Telekom auf die Agentennummer um.
2. Die Agentennummer liegt bei Twilio und ist mit dem Agenten in ElevenLabs verbunden.
3. Der Agent (Sprachmodell Claude) spricht mit dem Kunden und ruft dabei Werkzeuge im ERP auf:
   Kunde erkennen, Anfrage anlegen, freie Termine holen und buchen, Angebotsstand nennen,
   Rückruf anlegen, Bürozeiten prüfen. Weiterverbinden übernimmt ElevenLabs selbst.
4. Nach dem Gespräch schickt ElevenLabs Verlauf und Zusammenfassung an das ERP. Das Gespräch
   erscheint unter **Anrufe**. Hat der Agent nichts angelegt, entsteht die Aufgabe „Anruf prüfen“.

## Schritte

1. **ERP → Einstellungen → Telefonagent** (als Admin im jeweiligen Mandanten):
   zuständige Person, Bürozeiten, Besichtigungsfenster, Weiterleitungen, Notfallnummer und
   Leistungen eintragen. Noch nicht einschalten.
2. **ElevenLabs** (Bereich ElevenAgents): neuen Agenten anlegen.
   - Sprache Deutsch, Sprachmodell Claude, eine deutsche Stimme.
   - Erste Nachricht: die Begrüßung aus dem ERP.
   - System-Prompt: „Systemanweisung“ aus dem ERP kopieren.
   - Agent-ID ins ERP übernehmen.
3. **Werkzeuge**: im ERP „Schlüssel erzeugen“ (wird nur einmal angezeigt). In ElevenLabs je
   Eintrag aus „Werkzeuge (JSON)“ ein Webhook-Tool anlegen: URL, Methode POST, Parameter wie
   angegeben, Kopfzeile `Authorization: Bearer <Schlüssel>`. Die Parameter `anrufer` und
   `gespraech_id` mit den dynamischen Variablen `{{system__caller_id}}` und
   `{{system__conversation_id}}` belegen.
4. **Systemwerkzeuge** in ElevenLabs einschalten: „Transfer to number“ mit den Nummern aus den
   Weiterleitungen und der Notfallnummer, außerdem „End call“.
5. **Webhook nach dem Gespräch**: In ElevenLabs den Post-Call-Webhook auf
   `https://erp.baumpflegebund.de/api/agent/<kuerzel>/anruf-ende` setzen (`gbsd`, `rd`, `kud`),
   Transkript einschließen. Das angezeigte HMAC-Geheimnis im ERP speichern.
6. **Twilio**: deutsche Rufnummer je Firma kaufen (Adressnachweis nötig) und in ElevenLabs unter
   Telefonnummern verbinden.
7. **Testen**: zuerst mit der Testkonsole im ERP, dann im ElevenLabs-Testanruf, dann die
   Twilio-Nummer direkt anrufen. Erst danach im ERP einschalten.
8. **Telekom**: Rufumleitung bei Nichtmelden (z. B. nach 20 Sekunden) und bei Besetzt auf die
   Twilio-Nummer, außerhalb der Bürozeiten sofort.

## Datenschutz

- Die Begrüßung sagt, dass eine KI annimmt und das Gespräch aufzeichnet. Bitte nicht entfernen.
- Mit ElevenLabs und Twilio je einen Auftragsverarbeitungsvertrag mit Standardvertragsklauseln
  abschließen und im Verzeichnis der Verarbeitungstätigkeiten eintragen.
- Auskünfte zu Angeboten, Projekten und Terminen gibt der Agent nur, wenn die Rufnummer zu
  einem Kontakt passt. Ein genannter Name reicht nicht.
- In ElevenLabs die Aufbewahrungsdauer der Gespräche kurz einstellen; das ERP speichert Verlauf
  und Zusammenfassung selbst.

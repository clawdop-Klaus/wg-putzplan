# WG-Putzplan

Eine Putzplan-App für WGs, die auf **iPhone/iPad (Safari)** und **Android (Chrome)** läuft.
Kein Konto, kein Backend, offlinefähig – die Daten liegen auf dem Gerät.

## Was kann die App?

| Bereich | Funktion |
|---|---|
| **Woche** | Alle Räume mit Aufgabenliste, Filter „Meine Aufgaben“, Wochenwechsel (‹ / ›), Aufgaben abhaken, Aufgabe direkt bearbeiten, Schnellerfassung, Kalender-Export, Notizen pro Raum, „Alles erledigt“ |
| **Turnus** | Wochenübersicht der nächsten 6 Wochen, Reihenfolge der Mitglieder, feste oder wechselnde Raumzuordnung, automatische Verteilung, Aufgaben & Räume verwalten |
| **Statistik** | Punkte pro Person, Fairness-Kennzahl, **Fleißwoche** (Bestätigungen), **Pünktlichkeit**, Auslastung der nächsten 4 Wochen, Aktivität der letzten 8 Wochen, Zustand je Raum |
| **Mehr** | WG-Name, Hell/Dunkel, **Live-Sync** (Cloudflare), **Erinnerungen** (Web-Push), **Abwesenheiten**, **Einladungs-Link mit QR**, **Schlüssel sichern**, **Speicher dauerhaft behalten**, Impressum/Datenschutz, Code teilen, Code/Datei einlesen, Installation, Zurücksetzen |

### Die wichtigsten Bedienknöpfe

* **„Meine Aufgaben“** – oben in der Wochenansicht umschalten: zeigt nur die Räume, die an dir
  hängen. Das App-Icon zählt zusätzlich deine offenen Aufgaben (Badge, wenn das Gerät es unterstützt).
* **📅 in der Wochenleiste** – exportiert die Woche als Kalenderdatei (`.ics`). Jeder Raum wird zu
  einem Termin mit Aufgabenliste, Punkten und Zuständigkeit – das Handy erinnert dann von selbst.
* **Schnellerfassung** – unten in der Wochenansicht: Raum wählen, Aufgabe eintippen, fertig.
  Frequenz und Punkte werden von der zuletzt angelegten Aufgabe übernommen.
* **Rückgängig** – nach dem Löschen einer Aufgabe oder eines Raums erscheint im Toast ein
  „Rückgängig“-Knopf; es wird exakt an der alten Stelle wiederhergestellt.
* **Fairness** (Statistik) – zeigt, ob die Punkte gleichmäßig verteilt sind, und wie oft jede
  Person in den nächsten 4 Wochen dran ist.
* **Punkte bei täglichen Aufgaben:** Jeder abgehakte Tag zählt als eine Erledigung
  (mit den Punkten der Aufgabe). Eine tägliche Aufgabe mit 1 Punkt bringt also 7 Punkte
  pro Woche – das entspricht dem tatsächlichen Aufwand.

### Aufgaben und Turnus

* Jeder Raum hat eigene Aufgaben mit **Frequenz** und **Punkten**.
* **Frequenz:** Beim Anlegen und Bearbeiten einer Aufgabe wählbar –
  *täglich*, *alle x Tage*, *wöchentlich*, *alle x Wochen*, *monatlich*, *alle x Monate*.
  Man gibt das Intervall ein („alle **3** Tage“) und wählt die Einheit.
  Bei **täglichen** Aufgaben und „alle x Tagen“ steht in der Wochenansicht eine Zeile
  je fälligem Wochentag (Mo–So) – jede kann einzeln abgehakt werden.
  „Alle x Wochen“ und „alle x Monate“ heißen: die Aufgabe fällt nur in jedem x-ten
  Termin auf (Wochen bzw. Monate ab dem Planstart).
* **Zuständig je Aufgabe:** Standard ist der Turnus des Raums (wer den Raum hat).
  Man kann eine Aufgabe aber auch **fest einer Person** zuordnen – dann erledigt sie
  diese Person jede Woche, unabhängig vom Raum-Turnus. In der Wochenansicht steht
  dann „🔒 immer Name“ bei der Aufgabe.
* **Was das für die Bedienung heißt:** „Alles erledigt“ hakt nur die eigenen Aufgaben ab
  (auch im Raum einer anderen Person), der Filter „Meine Aufgaben“ zeigt nur Aufgaben,
  die wirklich dir gehören, und das App-Symbol zählt deine offenen **Aufgaben**
  (eine tägliche Aufgabe zählt einmal, nicht siebenmal).
  Wird eine Person gelöscht, wandern ihre fest zugewiesenen Aufgaben zurück in den Turnus.
* **Aufgaben erstellen und bearbeiten:** Im Tab *Turnus → Räume* jede Aufgabe antippen (oder den Stift
  in der Wochenansicht) – Raum, Titel, Frequenz und Punkte lassen sich dort ändern, Aufgaben können
  in einen anderen Raum verschoben oder gelöscht werden.
* **Punkte 1–4:** Beim Anlegen und Bearbeiten einer Aufgabe wählbar – 1 Punkt für „Geschirr abwaschen“,
  4 Punkte für „Bad komplett putzen“. Die Punkte zählen in die Statistik der Person, die die Aufgabe
  erledigt hat.
* **Feste oder wechselnde Zuordnung:** Je Raum wählbar. *Wechselnd* verteilt den Raum im Turnus auf
  alle Mitglieder, *Fest* bedeutet „diese Person immer“ (z. B. Person A immer Küche, Person B immer Bad).
  Die Einstellung steht unter *Turnus → Wochen → Raumzuordnung*.
* Der **Versatz je Raum** verschiebt, wer zuerst dran ist – so ist die Last gleichmäßig verteilt.
* „⚖️ Automatisch verteilen“ verteilt die Räume nach Aufgabenmenge auf die Mitglieder.
* Wer etwas erledigt, wird gebucht – entweder automatisch (aktive Person) oder per Tap auf eine
  bereits erledigte Aufgabe.

### Daten zwischen den Handys teilen (ohne Konto)

1. In **Turnus → Plan teilen → Code erzeugen** (oder **Mehr → Daten teilen**) einen Code erzeugen.
2. Code per Messenger/Mail verschicken – oder über „Teilen“ direkt aus der App.
3. Beim anderen: **Code einfügen** → **Prüfen** → **Übernehmen**.
   Beim Zusammenführen bleiben alle Erledigungen erhalten (der neuere Eintrag gewinnt).

Alternativ: **Als Datei sichern / Datei einlesen** (JSON) für Backups.
Zusätzlich kann der Stand als Link (`…/#s=…`) geteilt werden – beim Öffnen fragt die App,
ob der Plan übernommen werden soll.

### Fleißwoche: Anerkennung statt Rangliste

* Erledigte Aufgaben anderer lassen sich mit **🤝 Danke** bestätigen (Tipp: neben dem Namen
  der erledigten Person). Das ist reine Anerkennung – **kein Punkt, kein Rang, kein Geld**.
* Unter *Statistik → Fleißwoche* steht für die Woche, wie viele Bestätigungen wer bekommen hat
  und wer pünktlich war. Es gibt bewusst **keine Gesamtrangliste** und keine Minuspunkte.
* **Pünktlichkeit** zeigt, wie viele Aufgaben in der fälligen Woche erledigt wurden und wie viele
  später nachgetragen wurden. Das ist wichtig: Punkte steigen auch dann, wenn jemand fehlt –
  nur die Pünktlichkeit trennt „viel gemacht“ von „pünktlich gemacht“.
* **Abwesenheiten** (Mehr → Abwesenheiten): Urlaub oder Krankheit eintragen. Für diese Wochen
  pausieren die Punkte, damit Fairness und Belohnung nicht verzerrt werden.
* Die Auswertung bleibt vollständig auf dem Gerät – sie wird nicht an den Server geschickt
  (außer der normale Live-Sync, der ohnehin nur Chiffretext überträgt).

### Druckansicht und PDF

Unten in der Wochenansicht: **🖨 Plan drucken (PDF)**. Die Ansicht ist für die Pinnwand
gedacht (große Schrift, Kästchen zum Abhaken). Im Druckdialog „Als PDF speichern“ wählen –
so lässt sich der Wochenplan als PDF an die WG schicken.

### Einladungs-Link mit QR-Code

*Mehr → Daten teilen & sichern → Einladungs-Link (QR)* erzeugt einen Link
(`…/#wg=SCHLÜSSEL`) mit QR-Code. Der QR-Code wird **vollständig im Browser erzeugt**
(`qr.js`, MIT-Lizenz, siehe `qr-license.txt`) – der Schlüssel geht an keinen externen Dienst.
* Wer den Link öffnet, bekommt die Abfrage „Einladung annehmen?“ und sieht danach denselben Plan.
* Der Schlüssel steht nur im Fragment der Adresse (nach `#`) – er wird nie an einen Server geschickt.

### Speicher & Schlüssel

* **Speicher dauerhaft behalten** (Mehr): fragt den Browser, ob der lokale Speicher geschützt
  werden soll. Ohne das kann der Browser die Daten bei Platzmangel löschen.
* **WG-Schlüssel sichern**: legt eine Textdatei mit dem Schlüssel an – als Backup, falls das
  Gerät weg ist.

### Erinnerungen nach Wochentag

Unter *Mehr → Erinnerungen* lässt sich zusätzlich zur Uhrzeit einstellen, an **welchen Tagen**
die tägliche Erinnerung kommen soll (z. B. nur Montag bis Freitag). Ohne Auswahl: jeden Tag.

### Impressum & Datenschutz

In der App unter *Mehr → Rechtliches* verlinkt. Beide Seiten enthalten Platzhalter
(`⟨…⟩`) für die Angaben des Betreibers – die müssen vor der Veröffentlichung ausgefüllt werden.

## Installation aufs Handy

**iPhone / iPad (Safari)**
1. Link in Safari öffnen.
2. Teilen-Symbol → „Zum Home-Bildschirm“ → „Hinzufügen“.
3. Die App startet danach im Vollbild (ohne Browser-Leiste).

**Android (Chrome)**
1. Link in Chrome öffnen.
2. Drei-Punkte-Menü → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.
3. Alternativ erscheint in der App unter *Mehr* der Knopf „App installieren“.

Nach der Installation läuft die App auch offline (Service Worker) – der Putzplan ist dann
jederzeit verfügbar.

## Technik

* Reines HTML/CSS/JavaScript, **kein Build-Schritt**, keine Abhängigkeiten.
* Daten im `localStorage` des Geräts (`wgputzplan.v1`).
* Service Worker (`sw.js`) für Offline-Betrieb und Push-Empfang, Web App Manifest für die Installation.
* **Adaptives Abfragen:** der Sync prüft alle 30 s, danach immer seltener (bis 5 min), solange
  sich nichts ändert. Bei einer Änderung, beim Öffnen der App oder bei einer Push-Nachricht
  geht es sofort wieder los. Im Hintergrund pausiert das Abfragen ganz.
* Der Teilen-Code ist Base64 + `deflate-raw` komprimiert (Präfix `WGP1.Z`).

## Veröffentlichen (GitHub Pages)

1. Neues **öffentliches** Repository `wg-putzplan` anlegen (GitHub Pages ist im kostenlosen
   Account nur für öffentliche Repos verfügbar).
2. Den Inhalt dieses Ordners hochladen: entweder per Drag & Drop über
   *„uploading an existing file"* (Ordnerinhalt markieren und ins Browserfenster ziehen),
   oder per `git push`.
3. **Settings → Pages → Build and deployment → Source: *Deploy from a branch***,
   Branch `main`, Ordner `/(root)` → **Save**.
4. Nach etwa einer Minute ist die App unter
   `https://<dein-github-name>.github.io/wg-putzplan/` erreichbar.

Alle Pfade in der App sind relativ – sie läuft also auch in einem Unterordner wie `/wg-putzplan/`.

Alternativ per Kommandozeile (mit eigenem Token):

```bash
export GITHUB_TOKEN=ghp_xxxxxxxx
bash deploy_github.sh          # legt Repo an, pusht, aktiviert Pages
```

## Lokal testen

```bash
cd wg-putzplan
python3 -m http.server 8000
# http://localhost:8000 im Browser öffnen
```

> Für die Installation als App braucht es HTTPS (oder localhost).

## Dateien

```
wg-putzplan/
├── index.html            App-Rahmen
├── styles.css            Design (Hell/Dunkel, Safe-Area)
├── app.js                Logik: Turnus, Aufgaben, Punkte, Teilen, Fleißwoche
├── qr.js                 QR-Code-Erzeugung (lokal, MIT, siehe qr-license.txt)
├── impressum.html        Impressum (Platzhalter für den Betreiber)
├── datenschutz.html      Datenschutzerklärung
├── manifest.webmanifest  App-Manifest (Name, Icons, Standalone)
├── sw.js                 Service Worker (Offline)
├── icons/                Icons 192/512, Maskable, Apple-Touch, Favicon
└── server-worker.js      Quelltext des Sync-Servers (Cloudflare Worker + R2)
```

Der Sync-Server ist ein eigenständiger Cloudflare Worker mit einem R2-Bucket als Speicher.
Wer den Live-Sync nicht über `wg-putzplan-sync.wg-putzplan.workers.dev` nutzen möchte,
deployt `server-worker.js` auf den eigenen Worker (`wrangler deploy`) und trägt dessen Adresse
im Feld *Server* ein. Nötige Bindung: ein R2-Bucket mit dem Namen `PLANS`.

**Für die Erinnerungen (Push)** braucht der Worker zusätzlich:

* ein Secret `VAPID_PRIVATE` (PKCS#8, base64url) – erzeugt mit
  `node -e "const {generateKeyPairSync}=require('crypto');const k=generateKeyPairSync('ec',{namedCurve:'prime256v1',publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'der'}});console.log(k.privateKey.toString('base64url'))"`
* eine Variable `VAPID_PUBLIC` (der öffentliche Schlüssel, 65 Byte, base64url)
* optional einen Cron-Trigger (`0 * * * *`) für die tägliche Erinnerung

## Updates & Zwischenspeicher

Die App ist eine PWA: Beim ersten Öffnen werden alle Dateien in den Browser-Cache gelegt,
sodass sie offline läuft. Beim nächsten Start holt sich die App im Hintergrund eine frische
Version vom Server (stale-while-revalidate) – wer die App bereits installiert hat, bekommt
Updates also automatisch, ohne sie neu zu installieren. Erscheint oben ein Balken
„Neue Version verfügbar", genügt ein Klick.

## Live-Sync (optional)

Damit sich die WG nicht mehr Codes schicken muss, gibt es einen **Live-Sync**: Alle Geräte
teilen sich denselben Stand automatisch.

* **Einrichtung (einmalig):** Unter *Mehr* → *Live-Sync* auf **„Neu“** klicken (erzeugt einen
  zufälligen WG-Schlüssel), **Live-Sync aktiv** einschalten, fertig.
* **Weitergeben:** Den WG-Schlüssel den anderen mitteilen (Chat, SMS …). Wer ihn eintippt,
  sieht ab sofort denselben Plan – und Änderungen fließen in beide Richtungen.
* **Technik:** Ein Cloudflare Worker (`https://wg-putzplan-sync.wg-putzplan.workers.dev`)
  speichert den Plan in einem R2-Bucket. Die App fragt beim Start und danach alle 30 Sekunden
  ab, Änderungen werden gebündelt (1,2 s) hochgeladen.
* **Ende-zu-Ende-Verschlüsselung:** Der Plan wird im Gerät mit AES-GCM verschlüsselt (Schlüssel
  aus dem WG-Schlüssel abgeleitet). Auf dem Server liegt nur Chiffretext – weder Cloudflare noch
  der WG-Schlüssel-Besitzer sieht den Klartext ohne Passphrase. Für Geräte ohne
  WebCrypto-Unterstützung gibt es die Option, unverschlüsselt zu synchronisieren.
* **Eigene Installation:** Server-Adresse ist frei wählbar (Feld *Server*) – wer keinen
  Cloudflare-Zugang teilen will, trägt dort die eigene Adresse ein.

> **Wichtig:** Der WG-Schlüssel ist das einzige Zugangsmittel. Wer ihn verliert, kann den
> gespeicherten Plan nicht mehr öffnen – dann muss die WG neu aufsetzen (in *Mehr* auf
> *Zurücksetzen* und einen neuen Schlüssel erzeugen).

## Erinnerungen (Web-Push)

Unter *Mehr → Erinnerungen* kann die WG sich benachrichtigen lassen – ohne Konto, ohne Abo.

* **Was kommt an:** eine kurze Nachricht, wenn sich der Plan geändert hat, und eine tägliche
  Erinnerung zur selbst gewählten Uhrzeit (Voreinstellung 17 Uhr, jederzeit änderbar oder
  abschaltbar). *Testnachricht* prüft sofort, ob es funktioniert.
* **Was drinsteht:** nur ein Hinweis. Auf dem Server liegt kein Aufgabentext – der Plan selbst
  bleibt Ende-zu-Ende verschlüsselt, die Push-Nachricht enthält keine Details über Aufgaben oder
  Mitglieder.
* **Einrichtung:** Voraussetzung ist der Live-Sync (WG-Schlüssel). Ohne ihn gibt es nichts, worauf
  sich die Benachrichtigung beziehen könnte.
* **iPhone/iPad:** Safari kann erst ab iOS 16.4 Benachrichtigungen senden, und nur, wenn die App
  zum Home-Bildschirm hinzugefügt wurde. Die App weist darauf hin, wenn das fehlt.
* **Technik:** Der Worker hält die Push-Abonnements je WG und verschickt die Nachrichten nach
  RFC 8291/8188 verschlüsselt (AES-GCM) und mit VAPID signiert. Der private VAPID-Schlüssel liegt
  als Secret im Worker, der öffentliche wird von der App geladen.
* **Datenschutz:** Der Server sieht, dass ein Gerät eine Nachricht bekommt – nicht, worum es geht.
  Abmelden genügt: *Mehr → Erinnerungen → Ausschalten* entfernt das Abo sofort.

## Datenschutz

Ohne Live-Sync speichert die App **nur lokal** im `localStorage` des Geräts: Mitglieder, Räume,
Aufgaben und Erledigtes. Es werden keine Daten an einen Server übertragen, keine Konten
angelegt, keine Analyse- oder Tracking-Skripte eingebunden. Beim Teilen per Code verlässt der
Stand nur bewusst das Gerät (als Text/Link).

**Mit aktiviertem Live-Sync** wird der (verschlüsselte) Plan auf einem Cloudflare-Worker in
einem R2-Bucket gespeichert – nur solange der Live-Sync eingeschaltet ist. Sind die Erinnerungen
aktiv, liegen zusätzlich die Push-Abonnements (Endpunkt und Schlüssel des Geräts) auf dem Server –
nur so lange, bis sie abgemeldet werden. Die App sendet
dabei weder WG-Name noch Mitglieder-Namen im Klartext, wenn die Ende-zu-Ende-Verschlüsselung
aktiv ist. Der Server kennt nur einen Hash des WG-Schlüssels (als Zugriffstoken) und den
Chiffretext.

## Bedienhinweise (Stand Runde 4)

- **„Alles erledigt“** hakt nur die Aufgaben ab, die der aktuellen Person
  gehoeren – feste Zuweisungen an andere werden nicht veraendert.
- **Filter „Meine Aufgaben“** zeigt auch die Raeume, in denen eine Aufgabe
  fest der aktuellen Person zugeteilt ist.
- **App-Badge** zaehlt offene Aufgaben (nicht Tage-Eintraege).
- **Person loeschen** gibt deren feste Aufgaben in den Turnus zurueck.
- **Sync-Limit**: 5 MB pro Upload (Wochen mit nur Tagesaufgaben werden sonst
  beim Zusammenfuehren uebersprungen).

- **Feste Person pro Raum**: Im Dialog „Raum bearbeiten“ auf **Fest** stellen und
  die Person antippen – auch direkt beim Anlegen eines neuen Raums möglich.

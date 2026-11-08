# WG-Putzplan

Eine Putzplan-App für WGs, die auf **iPhone/iPad (Safari)** und **Android (Chrome)** läuft.
Kein Konto, kein Backend, offlinefähig – die Daten liegen auf dem Gerät.

## Was kann die App?

| Bereich | Funktion |
|---|---|
| **Woche** | Alle Räume mit Aufgabenliste, Wochenwechsel (‹ / ›), Aufgaben abhaken, Notizen pro Raum, „Alles erledigt“ |
| **Turnus** | Wochenübersicht der nächsten 6 Wochen, Reihenfolge der Mitglieder, Versatz je Raum, automatische Verteilung, Mitglieder & Räume verwalten |
| **Statistik** | Punkte pro Person, erledigte Aufgaben, Aktivität der letzten 8 Wochen, Zustand je Raum |
| **Mehr** | WG-Name, Hell/Dunkel, Code teilen, Code/Datei einlesen, Installation, Zurücksetzen |

### Aufgaben und Turnus

* Jeder Raum hat eigene Aufgaben mit **Frequenz** (wöchentlich, alle 2 Wochen, monatlich) und **Punkten**.
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
* Service Worker (`sw.js`) für Offline-Betrieb, Web App Manifest für die Installation.
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
├── app.js                Logik: Turnus, Aufgaben, Punkte, Teilen
├── manifest.webmanifest  App-Manifest (Name, Icons, Standalone)
├── sw.js                 Service Worker (Offline)
└── icons/                Icons 192/512, Maskable, Apple-Touch, Favicon
```

## Datenschutz

Die App speichert **nur lokal** im `localStorage` des Geräts: Mitglieder, Räume, Aufgaben und
Erledigtes. Es werden keine Daten an einen Server übertragen, keine Konten angelegt, keine
Analyse- oder Tracking-Skripte eingebunden. Beim Teilen per Code verlässt der Stand nur
bewusst das Gerät (als Text/Link).

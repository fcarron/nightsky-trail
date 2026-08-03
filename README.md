# nightsky trail

nightsky trail ist eine fokussierte Web-App zum Planen von Routen in der Schweiz. Sie ist bewusst kleiner gehalten als Komoot, Strava oder OpenRunner: Karte, Route zeichnen, Wege folgen, Höhenprofil, Wanderzeit, Schwierigkeitshinweise, GPX und gespeicherte Touren.

Keine Social Features, keine Aktivitätsaufzeichnung, keine Trainingsanalyse, keine Empfehlungen und keine Zahlungen.

## Funktionen

- Offizielle swisstopo Karten als Hauptkarte
- Wegpunkte per Klick setzen, verschieben, löschen, umkehren, undo/redo
- Neue Punkte direkt auf einer bestehenden Linie einfügen
- Standardmässig Routing entlang Wegen, optional gerade Abschnitte
- Segmentweise Umschaltung zwischen `Routing` und `Gerade`
- Distanz, Aufstieg, Abstieg, Höhe, Maximalgradient und hm/km
- Höhenprofil mit Gradient-Färbung
- Schweizer Wanderzeit nach segmentbasierter Polynomial-Methode
- Optionale persönliche Zeitschätzung über eigene min/km Pace
- Offizielle swisstopo Wanderweg-Kategorien
- Offizieller Wanderland-Routenoverlay
- Gemeldete Wanderweg-Sperrungen und Umleitungen
- Offizieller Veloland-Overlay
- Routing-Profil für Trail/Wandern und Velo
- OSM `sac_scale` Schwierigkeit als Zusatzhinweis
- Schwarze Warnmarker nur auf den passenden schwierigen Teilsegmenten
- Session-Login und gespeicherte Touren
- GPX Import und Export
- Installierbar als PWA

## Aktueller Stand

Das Projekt ist ein lokaler MVP/Prototyp. Die Kernplanung funktioniert, inklusive Routing über GraphHopper, Höhenprofil über swisstopo und lokalem OSM/swisstopo Trail-Matching für Schwierigkeitshinweise.

Persistenz ist absichtlich klein:

- Aktive Route bleibt im Browser Local Storage.
- Die PWA kann die App-Shell und die letzte lokale Route offline öffnen.
- Login nutzt Django Sessions.
- Gespeicherte Touren liegen in SQLite.
- Keine Cloud-Synchronisierung und keine öffentlichen Profile.
- Karten, Routing, Höhenprofil und externe Overlays brauchen weiterhin Netzwerk.

## GitHub Status

Das Repository ist vorbereitet für Veröffentlichung als Projekt-Quellcode, aber vor einem öffentlichen Push sollten noch zwei Entscheidungen bewusst getroffen werden:

- **Code-Lizenz festlegen:** Aktuell ist keine `LICENSE` Datei enthalten. Ohne explizite Lizenz bleiben die Rechte standardmässig vorbehalten. Eine permissive Lizenz wie MIT oder Apache-2.0 wäre möglich, muss aber bewusst gewählt werden.
- **Produktionsbetrieb klären:** Die Docker-Compose-Konfiguration ist primär für lokale Entwicklung. Für öffentliche Nutzung sollten `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, `DJANGO_ALLOWED_HOSTS`, HTTPS, persistente Volumes, Backups und Dienstlimits sauber gesetzt werden.

Nicht im Repo enthalten und bewusst durch `.gitignore` ausgeschlossen:

- `.env`
- SQLite-Datenbanken
- OSM `.osm.pbf` Extrakte
- GraphHopper Graph-Cache
- swisstopo GeoPackage/ZIP-Daten
- Frontend `node_modules` und Build-Artefakte

Weitere Vorbereitungspunkte stehen in [docs/github-prep.md](docs/github-prep.md).

## Architektur

```text
frontend React/Vite/OpenLayers
        |
        | /api/v1/*
        v
backend Django REST Framework
        |
        +-- GraphHopper: Routing auf OSM Schweiz
        +-- swisstopo: Höhenprofil und offizielle Daten
        +-- lokaler OSM Index: sac_scale Schwierigkeit
```

Wichtige Verzeichnisse:

```text
backend/                  Django API
backend/planner/api/      HTTP Views, Serializer, URLs
backend/planner/domain/   reine Berechnungen
backend/planner/services/ Orchestrierung
backend/planner/integrations/ externe Adapter
frontend/src/app/         App Shell
frontend/src/features/    Karte, Route, Höhenprofil, Trail Difficulty
frontend/src/services/    typisierte API Wrapper
docs/                     Architektur und Datenquellen
```

## Voraussetzungen

Empfohlen:

- Docker und Docker Compose
- `make`

Für lokale Entwicklung ohne Docker:

- Python 3.13 oder kompatibel
- `uv`
- Node `^20.19.0 || >=22.12.0`
- npm
- Docker trotzdem für GraphHopper

Die lokale System-Node-Version muss die in `frontend/package.json` definierte Engine erfüllen. Falls lokale Checks wegen einer älteren Node-Version scheitern, nutze die Docker-Frontend-Umgebung.

## Installation Mit Docker Compose

1. Umgebung vorbereiten:

```bash
cp .env.example .env
```

Die Beispielwerte sind Docker-freundlich. Für rein lokale Entwicklung können die `OSM_*` und `SWISSTOPO_TRAILS_*_PATH` Werte in `.env` weggelassen werden; dann nutzt Django die Projektpfade unter `data/`.

2. GraphHopper OSM-Extrakt laden und GraphHopper starten:

```bash
make graphhopper
```

Das lädt bei Bedarf `data/osm/switzerland-latest.osm.pbf` und baut später den GraphHopper-Cache unter `data/graphhopper/`. Beides ist von git ignoriert.

Wenn sich `docker/graphhopper/config.yml` ändert, zum Beispiel durch neue Profile wie `bike`, muss der generierte GraphHopper-Cache neu aufgebaut werden: GraphHopper stoppen, `data/graphhopper/` entfernen und `make graphhopper` erneut starten.

3. Backend und Frontend starten:

```bash
docker compose up backend frontend
```

4. Datenbankmigrationen ausführen:

```bash
docker compose exec backend uv run python manage.py migrate
```

5. App öffnen:

```text
http://127.0.0.1:5173
```

Backend API:

```text
http://127.0.0.1:8000/api/v1/health
http://127.0.0.1:8000/api/docs/
```

## Lokale Installation

1. Umgebung vorbereiten:

```bash
cp .env.example .env
```

2. Dependencies installieren:

```bash
make bootstrap
```

3. GraphHopper starten:

```bash
make graphhopper
```

4. Django Migrationen ausführen:

```bash
cd backend
uv run python manage.py migrate
```

5. Backend und Frontend starten:

```bash
make dev
```

Danach läuft:

```text
Frontend: http://127.0.0.1:5173
Backend:  http://127.0.0.1:8000
```

## Bedienung

### Route Zeichnen

- Klick auf die Karte setzt einen Wegpunkt.
- Im Modus `Magnet` folgt ein neuer Abschnitt Wegen über GraphHopper.
- Im Modus `Gerade` wird ein direkter Abschnitt gezeichnet.
- Wegpunkte können gezogen werden.
- Klick auf einen Wegpunkt selektiert ihn; danach kann er gelöscht werden.
- Linie anklicken/ziehen fügt einen neuen Zwischenpunkt ein.
- Abschnitte können einzeln zwischen `Routing` und `Gerade` umgeschaltet werden.

Wenn Routing fehlschlägt, bleibt die letzte gültige Route sichtbar. Die App ersetzt fehlgeschlagenes Routing nicht still durch eine gerade Linie.

### Höhenprofil Und Zeit

Das Höhenprofil basiert auf swisstopo Höhenprofil-Daten. Die App glättet die Höhenwerte, berechnet Gradient über kurze Distanzfenster und zeigt den Gradient als Farbbänder im Profil.

Die Wanderzeit wird nicht aus totaler Distanz plus totalem Aufstieg geschätzt. Stattdessen:

```text
Route
-> swisstopo Höhenprofil
-> geglättete Höhen
-> 50-m-Segmente
-> Steigung pro Segment
-> Schweizer Polynomial-Methode
-> Summe der Segmentzeiten
```

Optional kann eine persönliche Pace in `min/km` aktiviert werden. Diese ist eine einfache kalibrierte Zeitschätzung und ersetzt nicht die offizielle Wanderzeit-Berechnung.

### Wanderwege Und Schwierigkeit

Die offizielle swisstopo Wanderweg-Darstellung bleibt die Hauptinformation:

- Wanderweg
- Bergwanderweg
- Alpinwanderweg

OSM `sac_scale` wird als Zusatzinformation verwendet. Fehlende Schwierigkeit ist unbekannt, nie automatisch T1.

Die schwarzen Warnmarker erscheinen nur, wenn ein OSM-Segment zuverlässig zu einem offiziellen swisstopo Weg passt und die Kombination explizit als Warnung definiert ist:

- Bergwanderweg + T3
- Alpinwanderweg + T5
- Alpinwanderweg + T6

Die Schwierigkeit wird nicht auf den ganzen swisstopo Weg übertragen.

### Login Und Touren Speichern

Registrierung und Login laufen lokal über Django Sessions. Nach dem Login kann die aktuelle Route als Tour gespeichert und später wieder geladen werden.

Gespeicherte Touren enthalten den normalisierten Route-Plan mit Wegpunkten und Segmentmodi. Ein Benutzer kann nur eigene Touren lesen, ändern oder löschen.

### GPX Import/Export

GPX Export schreibt die berechnete Route, falls vorhanden. Wenn noch keine berechnete Route vorhanden ist, werden die Wegpunkte exportiert.

GPX Import liest lokale `trkpt`, `rtept` oder `wpt` Koordinaten und erstellt daraus eine editierbare manuelle Route mit geraden Segmenten. Importierte GPX-Dateien werden nicht automatisch neu geroutet.

## Wichtige API Endpunkte

```http
GET    /api/v1/health
POST   /api/v1/route/compute
POST   /api/v1/elevation/profile
GET    /api/v1/trails?bbox=minLon,minLat,maxLon,maxLat&zoom=14

GET    /api/v1/auth/session
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout

GET    /api/v1/tours
POST   /api/v1/tours
GET    /api/v1/tours/{id}
PATCH  /api/v1/tours/{id}
DELETE /api/v1/tours/{id}
```

OpenAPI:

```text
http://127.0.0.1:8000/api/schema/
http://127.0.0.1:8000/api/docs/
```

## Datenquellen

- swisstopo Karten: offizielle Schweizer Karten und Basiskarten
- swisstopo Höhenprofil: `https://api3.geo.admin.ch/rest/services/profile.json`
- swisstopo/ASTRA Wanderland: offizielle SchweizMobil-Wanderrouten
- swisstopo/ASTRA Wanderland Sperrungen/Umleitungen: gemeldete Einschränkungen auf Wanderwegen
- swisstopo/ASTRA Veloland: offizieller Fahrrad-Routenoverlay
- GraphHopper: Trail- und Velo-Routing auf lokalem OSM Schweiz Extrakt
- OpenStreetMap: Wege und `sac_scale` Schwierigkeit
- swisstopo OGD: offizielle Wanderweg-Kategorien für Matching

Details und Einschränkungen stehen in [docs/data-sources.md](docs/data-sources.md).

Die Datenquellen und Karten-/Routingdaten haben eigene Nutzungsbedingungen und Lizenzen. Eine spätere Code-Lizenz für dieses Repository ändert diese Datenquellen-Lizenzen nicht.

## Konfiguration

Die wichtigsten Variablen stehen in `.env.example`:

```bash
DJANGO_DEBUG=true
DJANGO_SECRET_KEY=change-me-in-development
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5173

GRAPHHOPPER_BASE_URL=http://localhost:8989
GRAPHHOPPER_PROFILE=hike

SWISSTOPO_BASE_URL=https://api3.geo.admin.ch

OSM_PBF_PATH=/app/data/osm/switzerland-latest.osm.pbf
OSM_TRAIL_INDEX_PATH=/app/data/osm/trails.sqlite3
```

Für Docker Compose zeigt der Backend-Container automatisch auf:

```bash
GRAPHHOPPER_BASE_URL=http://graphhopper:8989
```

Für lokale Entwicklung ohne Docker sind die Default-Pfade meist besser als die `/app/...` Pfade aus `.env.example`. Diese Variablen können dann aus `.env` entfernt oder auf absolute lokale Pfade gesetzt werden.

## Entwicklung

Tests:

```bash
make test
```

Lint:

```bash
make lint
```

Formatierung:

```bash
make format
```

Build:

```bash
make build
```

Einzelne Checks:

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run pytest

cd frontend
npm run lint
npm run typecheck
npm run test -- --run
npm run build
```

Hinweis: In manchen lokalen Umgebungen ist die Node-Version für das Frontend-Linting zu alt. Die Docker-Frontend-Umgebung nutzt Node 24.

## Projektregeln

- Schweiz zuerst.
- Planung zuerst.
- Externe Dienste nur über Backend-Adapter.
- Keine Live-Netzwerkaufrufe in Unit Tests.
- Fehlende OSM Schwierigkeit bleibt unbekannt.
- Kein stiller Fallback von Routing auf gerade Linie.
- Keine grossen Frameworks oder Abstraktionen ohne konkreten Bedarf.
- Neue Features klein, testbar und dokumentiert halten.

## Weitere Dokumentation

- [docs/architecture.md](docs/architecture.md)
- [docs/data-sources.md](docs/data-sources.md)

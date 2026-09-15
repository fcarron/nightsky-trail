# SAC-Hütten

`data/sac_huts.geojson` ist der lokale Datenbestand für den Karten-Layer
**SAC-Hütten**. Die Anwendung lädt diese Datei ausschliesslich über das Django-
API; beim Anzeigen der Karte findet keine Anfrage an SAC, Wikipedia oder eine
andere externe Quelle statt.

Der Bestand wird mit `scripts/update_sac_huts.py` aktualisiert. Das Skript liest
die öffentlich gepflegte [Liste der Hütten des Schweizer Alpen-Clubs][source],
welche die offiziellen SAC-Hütten samt direkten Links ins SAC-Tourenportal
aufführt. Für jede gelistete Hütte liest es dann einmalig die aktuelle
Höhe und Kartenposition aus dem offiziellen SAC-Tourenportal. Es übernimmt
nur Name, Höhe, Koordinate und die SAC-Tourenportal-ID und erzeugt daraus
kompaktes GeoJSON:

```bash
python scripts/update_sac_huts.py
```

Für einen reproduzierbaren Update-Lauf kann die heruntergeladene Wikitext-Datei
gespeichert und mit `--source datei.wikitext` übergeben werden. `--skip-official`
ist nur für Offline-Parserdiagnosen vorgesehen und darf nicht für veröffentlichte
Daten verwendet werden. Vor dem Committen sind die Anzahl der Features und
stichprobenartig Namen, Positionen, Höhen und SAC-Links zu prüfen. Die Liste
steht unter [CC BY-SA 4.0][cc-by-sa].

[source]: https://de.wikipedia.org/wiki/Liste_der_H%C3%BCtten_des_Schweizer_Alpen-Clubs
[cc-by-sa]: https://creativecommons.org/licenses/by-sa/4.0/deed.de

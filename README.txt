Andys Rezeptbox V2.2

Neu in V2.2:
- Rezeptimport aus kopiertem Text (z.B. Facebook, Website, WhatsApp)
- automatische Aufteilung in Titel, Zutaten und Zubereitung soweit erkennbar
- Quelle / Facebook-Link speichern
- mehrere Bilder pro Rezept
- erstes Bild wird als Titelbild verwendet
- Bilder per Dateiauswahl, Drag & Drop oder Einfügen aus der Zwischenablage
- vorhandene V2-Rezepte bleiben kompatibel

Start am PC:
1. ZIP vollständig entpacken.
2. index.html im entpackten Ordner öffnen.
3. Alle Dateien im Ordner zusammen lassen.

Wichtig:
Die Rezepte werden lokal im Browser gespeichert. Regelmässig die Sicherungsfunktion verwenden.


V2.3: Verbesserte Erkennung von Zutaten/Zubereitung beim Import aus Facebook und Webseiten.

V2.4: Bilder im Rezeptformular nun per Strg+V, Drag & Drop oder Dateiauswahl einfügbar. Erstes Bild = Titelbild.

V2.5: Importbereinigung erweitert; Bilder lassen sich per Drag & Drop neu sortieren. Erstes Bild bleibt Titelbild.

V2.6: Eigene Kategorien können erstellt werden; sie werden in Backup/Wiederherstellung mitgesichert.

V2.7:
- Bilder können nun auch direkt von vielen Webseiten in die Rezeptbox gezogen werden.
- Wenn möglich wird das Bild dauerhaft als Bilddaten gespeichert.
- Wenn eine Webseite den Download blockiert, wird die Bildadresse verwendet und eine verständliche Meldung angezeigt.
- Fallback bleibt: Bild kopieren + Strg+V oder Datei auswählen.

V2.8:
- Doppelte Bilder beim Ziehen von Webseiten werden automatisch erkannt und nicht mehrfach übernommen.
- Auch Varianten derselben Bildadresse mit typischen Größen-/Tracking-Parametern werden zusammengefasst.

V2.9:
- Ein von einer Webseite gezogenes Bild wird pro Drag-Vorgang nur einmal übernommen.
- src/srcset/Thumbnail-Mehrfachvarianten werden nicht mehr alle importiert.
- Warnhinweise haben wieder echte Zeilenumbrüche.

V3.0:
- Import trennt Zutaten und Zubereitung deutlich robuster.
- Mengen- und Zutatenzeilen vor „Zubereitung“ werden automatisch ins Zutatenfeld verschoben.
- Versehentlich im Zubereitungsfeld gelandete Zutaten am Anfang werden nachträglich korrigiert.

V3.1:
- Ein Video pro Rezept möglich.
- Video-Link (Facebook, YouTube, direkter MP4/WebM-Link) kann gespeichert werden.
- Kleine Videodateien bis ca. 4 MB können direkt in der Rezeptbox gespeichert und abgespielt werden.
- YouTube-Links werden im Rezept eingebettet; andere Webvideos öffnen über einen Video-Button.
- Rezeptkarten zeigen ein Video-Symbol, wenn kein Titelbild vorhanden ist.

V3.2:
- Neue Funktion „Sicherung hinzufügen“.
- Backup-Rezepte werden mit der bestehenden Sammlung zusammengeführt.
- Vorhandene Rezepte bleiben erhalten.
- Doppelte Rezepte werden anhand Titel, Kategorie, Zutaten und Zubereitung übersprungen.
- Eigene Kategorien aus dem Backup werden ebenfalls ergänzt.

V3.3:
- Neue Bilder werden vor dem Speichern automatisch auf max. 1400 px verkleinert und als kompaktes JPEG gespeichert.
- Dadurch passen deutlich mehr Rezeptbilder in den lokalen Browser-Speicher.
- Beim Speichern wird ein voller Browser-Speicher jetzt erkannt und verständlich gemeldet.
- Ein Rezept wird bei Speicherfehler nicht halb gespeichert.

V3.4:
- Rezeptdaten werden neu in IndexedDB statt im kleinen localStorage gespeichert.
- Dadurch steht wesentlich mehr Speicher für Rezepte, Bilder und kleine Videos zur Verfügung.
- Vorhandene Rezepte aus dem alten localStorage werden beim ersten Start automatisch übernommen.
- Nach erfolgreichem Speichern wird der alte grosse localStorage-Rezeptblock entfernt.
- Backup / Sicherung hinzufügen / Wiederherstellen bleiben erhalten.

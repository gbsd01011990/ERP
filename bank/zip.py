# -*- coding: utf-8 -*-
"""ZIP aus JSON [{name, daten(base64)}] auf stdin bauen, ZIP auf stdout. Nur Standardbibliothek."""
import base64
import io
import json
import sys
import zipfile

puffer = io.BytesIO()
with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
    for d in json.load(sys.stdin):
        name = d["name"].replace("\\", "/").lstrip("/")
        if ".." in name.split("/"):
            raise SystemExit("Ungültiger Dateiname")
        z.writestr(name, base64.b64decode(d["daten"]))
sys.stdout.buffer.write(puffer.getvalue())

"""A volume object is drawn as itself only when a browser draws it safely (the user, 2026-11-25, "Catalog extras: …
more file previews"). Its type is the uploader's browser's word: an HTML or SVG object served inline ran its script on
the API's origin from the Catalog's Download link."""
from __future__ import annotations

from pramanyx.routers.volumes import object_headers


def test_an_image_text_or_pdf_is_drawn_and_never_sniffed():
    for mime in ("image/png", "text/plain; charset=utf-8", "application/json", "text/tab-separated-values"):
        h = object_headers("a", mime)
        assert "Content-Disposition" not in h and h["X-Content-Type-Options"] == "nosniff"
        assert h["Content-Security-Policy"] == "sandbox"
    pdf = object_headers("report.pdf", "application/pdf")
    assert "Content-Disposition" not in pdf and "Content-Security-Policy" not in pdf    # a PDF viewer cannot run sandboxed


def test_html_svg_and_anything_unknown_go_as_a_download_and_run_nothing():
    for mime in ("text/html", "image/svg+xml", "application/octet-stream", ""):
        h = object_headers("page one.html", mime)
        assert h["Content-Disposition"] == "attachment; filename*=UTF-8''page%20one.html"
        assert h["Content-Security-Policy"] == "sandbox"

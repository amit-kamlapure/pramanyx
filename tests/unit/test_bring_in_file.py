"""A file the person attaches in the coworker, brought into Pramanyx as theirs (the ontology study, Phase 2,
2026-11-17): a table becomes a sheet, a document a document — read only from the coworker's attachments folder, so the
model can never point the tool at another file on the machine."""
from __future__ import annotations

import asyncio
import json
import os

import httpx

from pramanyx.mcp import client as K


def test_only_a_file_inside_the_attachments_folder_is_read(tmp_path, monkeypatch):
    root = tmp_path / "attachments"
    (root / "v1" / "files" / "ab").mkdir(parents=True)
    inside = root / "v1" / "files" / "ab" / "orders.csv"
    inside.write_text("id,amount\n1,10\n")
    outside = tmp_path / "secret.txt"
    outside.write_text("not yours")
    (root / "v1" / "files" / "ab" / "link.csv").symlink_to(outside)
    monkeypatch.delenv("PRAMANYX_ATTACHMENTS_DIR", raising=False)
    assert "did not say where" in K.attached_file(str(inside))
    monkeypatch.setenv("PRAMANYX_ATTACHMENTS_DIR", str(root))
    assert K.attached_file(str(inside)) == (os.path.realpath(inside), inside.stat().st_size)
    for bad in (str(outside), str(root / "v1" / ".." / ".." / "secret.txt"), str(root / "v1" / "files" / "ab" / "link.csv"),
                "/etc/passwd", "~/.ssh/id_rsa"):
        assert "not one" in K.attached_file(bad), bad
    assert "no attached file" in K.attached_file(str(root / "v1" / "files" / "missing.csv"))
    monkeypatch.setattr(K, "MAX_ATTACHED_BYTES", 4)
    assert "the most brought in" in K.attached_file(str(inside))


def _client(seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.content[:400]))
        if request.url.path == "/sheets/files":
            return httpx.Response(200, json={"token": "tok1", "file": "orders.csv", "size": 15, "tabs": [{"tab": ""}]})
        if request.url.path == "/sheets":
            body = json.loads(request.content)
            assert body == {"source": "file", "token": "tok1", "tabs": [{"tab": "", "name": "orders"}]}
            return httpx.Response(200, json={"sheets": [{"id": "sh1", "name": "orders", "table": "orders_sh1", "row_count": 1}]})
        if request.url.path == "/documents/upload":
            return httpx.Response(201, json={"doc_id": "d1", "title": "Plan", "chunk_count": 3})
        return httpx.Response(404, json={"detail": "no"})
    return K.PramanyxClient(base_url="http://test", transport=httpx.MockTransport(handler))


def test_a_table_becomes_the_person_s_sheet_and_a_document_their_document(tmp_path, monkeypatch):
    root = tmp_path / "attachments"
    root.mkdir()
    (root / "orders.csv").write_text("id,amount\n1,10\n")
    (root / "plan.md").write_text("# Plan\n\nWhat we will do next year.")
    (root / "song.mp3").write_bytes(b"ID3")
    monkeypatch.setenv("PRAMANYX_ATTACHMENTS_DIR", str(root))
    seen: list = []
    c = _client(seen)
    sheet = asyncio.run(c.bring_in_file(str(root / "orders.csv"), name="orders.csv"))
    assert (sheet["brought_in"], sheet["kind"], sheet["connection"]) == (True, "sheet", "sheets")
    assert sheet["sheets"] == [{"id": "sh1", "name": "orders", "table": "orders_sh1", "rows": 1, "open": "/sheets/sh1"}]
    assert "only the person can see it" in sheet["private"]
    assert [p for _m, p, _b in seen] == ["/sheets/files", "/sheets"] and b"id,amount" in seen[0][2]
    doc = asyncio.run(c.bring_in_file(str(root / "plan.md")))
    assert (doc["kind"], doc["document"]["id"], doc["document"]["chunks"]) == ("document", "d1", 3)
    nothing = asyncio.run(c.bring_in_file(str(root / "song.mp3")))
    assert nothing["brought_in"] is False and "neither a table nor a document" in nothing["why"]
    refused = asyncio.run(c.bring_in_file("/etc/hosts"))
    assert refused == {"brought_in": False, "why": "only a file the person attached in this conversation is brought in; that path is not one"}

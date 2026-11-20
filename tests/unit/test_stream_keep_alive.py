"""A long silent stretch keeps the stream open (seen live 2026-11-20: a deep analysis handed off from the Ask panel spent
320 s in one phase without a frame; the web's fetch drops a body silent for 300 s, and the run was cancelled at six
minutes). A bridge with nothing to send says so as an SSE comment, which every reader skips."""
from __future__ import annotations

import asyncio
import time

import pramanyx.routers.investigations as inv


def test_a_silent_body_is_kept_open_and_its_frames_still_arrive_in_order(monkeypatch):
    monkeypatch.setattr(inv, "KEEP_ALIVE_EVERY", 0.05)

    def body(emit, cancelled):
        emit("status", {"text": "starting"})
        time.sleep(0.25)                                 # a long phase, saying nothing
        emit("headline", {"headline": "Done."})
        return "ok"

    async def go():
        return [item async for item in inv._core_frames(body)]
    got = asyncio.run(go())
    frames = [t for t, _ in got if t is not inv._KEEP_ALIVE]
    assert frames == ["status", "headline"]
    assert sum(1 for t, _ in got if t is inv._KEEP_ALIVE) >= 2


def test_the_keep_alive_is_a_comment_no_reader_takes_for_a_frame():
    assert inv.KEEP_ALIVE_SAID.startswith(":") and "data:" not in inv.KEEP_ALIVE_SAID and inv.KEEP_ALIVE_SAID.endswith("\n\n")
    from pathlib import Path
    reader = (Path(__file__).resolve().parents[2] / "web" / "lib" / "sseFrames.ts").read_text()
    assert 'line.startsWith("data:")' in reader and "if (!data.length) return null;" in reader

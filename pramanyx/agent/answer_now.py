"""Answer now (punch list 89, 2026-11-18): a person stops a running deep analysis and has it answer from what it has.

Cancelling a run kills its job and answers nothing. Here the person's word is kept for the run (by its investigation
id, in this process, where the run's job runs) and every place a deep run decides whether to keep going — the
hypothesis loop, the exploration's sub-questions and waves, the analysis's phases — goes to its write-up instead. The
write-up is the run's own synthesis of what it found; the report says it was answered early, at the person's word,
before every planned step had run.
"""
from __future__ import annotations

import threading
import time
from typing import Callable

#: investigation id → when the person asked
_ASKED: dict[str, float] = {}
_LOCK = threading.Lock()
#: A word kept longer than a day belongs to a run that is long over.
_KEPT_FOR = 24 * 3600.0

#: What a report answered early says.
SAID = "Answered now, at your word: some of the steps it planned did not run, so it says less than it might have."


def ask(investigation_id: str) -> None:
    if not investigation_id:
        return
    with _LOCK:
        now = time.time()
        for old in [k for k, at in _ASKED.items() if now - at > _KEPT_FOR]:
            _ASKED.pop(old, None)
        _ASKED[investigation_id] = now


def was_asked(investigation_id: str) -> bool:
    with _LOCK:
        return bool(investigation_id) and investigation_id in _ASKED


def asked(state) -> bool:
    """Whether the person asked the run in ``state`` to answer now."""
    try:
        return was_asked(str((state or {}).get("investigation_id") or ""))
    except Exception:  # noqa: BLE001 — a state that cannot be read keeps its own route
        return False


def or_write_up(route: Callable, write_up: str) -> Callable:
    """``route``, unless the person asked this run to answer now: then its write-up."""
    def routed(state):
        return write_up if asked(state) else route(state)
    routed.__name__ = getattr(route, "__name__", "route")
    routed.__doc__ = getattr(route, "__doc__", None)
    return routed


def forget(investigation_id: str) -> None:
    with _LOCK:
        _ASKED.pop(investigation_id, None)

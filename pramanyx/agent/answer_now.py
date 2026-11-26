"""Answer now (punch list 89, 2026-11-18): a person stops a running deep analysis and has it answer from what it has.

Cancelling a run kills its job and answers nothing. Here the person's word is kept for the run (by its investigation
id, in this process, where the run's job runs) and the analyst, deciding whether to keep going, goes to its write-up
instead (`finish_now`). The write-up is the run's own synthesis of what it found; the report says it was answered
early, at the person's word, before every planned step had run.
"""
from __future__ import annotations

import threading
import time

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


def forget(investigation_id: str) -> None:
    with _LOCK:
        _ASKED.pop(investigation_id, None)

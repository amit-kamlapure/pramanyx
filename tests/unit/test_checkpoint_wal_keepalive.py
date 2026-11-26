"""The checkpoint store is the one #379 skipped — and it kept crashing the API.

#379 removed the SIGBUS precondition for every store on the `connect_store` seam: one
idle connection per store means SQLite never sees a last close, so `-wal`/`-shm` are
never unlinked under a live mapping. `tests/unit/test_store_wal_keepalive.py` asserts
that invariant and has passed ever since.

The API went on dying anyway. Measured 2026-08-23 from `~/Library/Logs/DiagnosticReports`:
five crashes across two days — 08-22 23:57, 08-23 00:58, 09:25, 18:21, 18:31 — all
identical, all `EXC_BAD_ACCESS / SIGBUS · "FS pagein error: 22"`, all faulting in
`walFindFrame`, with the fault address inside a 32 KB mapped-file region (a `-shm`).

`pramanyx/agent/graph.py` says why, in its own comment: the checkpointer is "deliberately
NOT on the connect_store seam" because LangGraph's `SqliteSaver` speaks to the connection
directly and wrapping it is unproven. That reasoning is sound and is not what these tests
change. What it missed is that opting out of the SEAM also opted out of the KEEPALIVE —
and `_checkpointer()` is not memoized, so every call opened a fresh WAL connection to a
151 MB store and dropped it on GC. Every call was a last close.

The existing suite could not catch this because it tests the MECHANISM against a store
that uses it. These test COVERAGE: that the store which opted out still holds its WAL,
and that a future store cannot opt out silently.

A real SIGBUS would take the runner down with it, so — like the sibling file — these
assert the invariant (`-shm` is never unlinked) rather than reproducing the fault.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

pytest.importorskip("langgraph.checkpoint.sqlite", reason="langgraph not installed")


def _shm_inode(db: Path):
    try:
        return os.stat(str(db) + "-shm").st_ino
    except FileNotFoundError:
        return None














# ── the coverage ratchet ────────────────────────────────────────────────────────

#: Every bare `sqlite3.connect(` in `pramanyx/` must be accounted for. A store that opens
#: its own connection is fine; a store that opens its own connection AND holds no
#: keepalive is the defect this file exists for, and it is invisible until the API dies
#: with no traceback. Adding a file here means deciding which of the two it is.
_SEAM_EXEMPT = {
    # A USER's own SQLite file opened as a data source, not a platform store: its
    # lifetime is the connector's and it is never written by two of our threads.
    "pramanyx/connectors/file/sqlite.py",
    # One-shot read of a legacy file during migration; the process is not serving.
    "pramanyx/custom_agents/store.py",
    # The seam itself, and the tuning helper's docstring example.
    "pramanyx/db/backend.py",
    "pramanyx/db/sqlite_util.py",
    # IN-4's one-time state migration. Same shape as `custom_agents/store.py` above: it runs
    # with the API STOPPED (it refuses otherwise, naming the serving pid), reads the source
    # read-only and writes each destination exactly once. A WAL keepalive here would be the
    # opposite of what is wanted — it would hold handles open on the very files being copied.
    "pramanyx/db/migrate.py",
    # Arc SV-1's copy before a migration: it opens a file it has just created to receive the
    # backup, and then the copy read-only to check it — each once, closed at once. Neither is
    # a store; a keepalive would hold a handle on a file nothing else ever opens.
    "pramanyx/db/migrations.py",
    # Arc SV-2's rolling backups. Inside the serving API it opens each store READ-ONLY, once, for one backup, in the
    # same process whose keepalive already holds the store's WAL — a read-only close never checkpoints or unlinks it
    # (measured: the fingerprint of the file and its `-wal` is unchanged after one). It never registers a keepalive
    # itself: `hold_wal_open` sets WAL mode, which is a write, and a backup writes nothing into what it copies. Its
    # other connections are to files it has just made (the copy, a staged restore), and `pramanyx restore` runs only
    # with the API stopped.
    "pramanyx/db/backups.py",
    # `residue_of` (idea 1): after a delete it opens every SQLite file under the data dir
    # READ-ONLY (`mode=ro`), once, to look for the deleted id. It writes nothing and holds
    # nothing; a keepalive would only pin files that belong to other stores.
    "pramanyx/db/purge.py",
}


def test_no_store_opens_sqlite_without_being_accounted_for():
    """The guard the last fix was missing.

    #379 protected every store on the seam and shipped. The one store that had opted out
    kept crashing the API for a further two days, because nothing anywhere asserted that
    opting out of the seam was a decision somebody made rather than a thing that happened.
    """
    root = Path(__file__).resolve().parents[2] / "pramanyx"
    offenders = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root.parent).as_posix()
        if rel in _SEAM_EXEMPT:
            continue
        if re.search(r"\bsqlite3\.connect\(", path.read_text(encoding="utf-8")):
            offenders.append(rel)
    assert offenders == [], (
        f"{offenders} open SQLite directly, bypassing `connect_store` and therefore the "
        f"WAL keepalive. Either route them through `connect_store`, or call "
        f"`_hold_wal_open` on the path and add the file to _SEAM_EXEMPT with the reason.")


def test_the_exempt_list_has_not_gone_stale():
    """An exemption for a file that no longer opens SQLite is a hole waiting for the next
    author: the name stays on the list and stops meaning anything."""
    root = Path(__file__).resolve().parents[2]
    stale = [rel for rel in sorted(_SEAM_EXEMPT)
             if not re.search(r"\bsqlite3\.connect\(", (root / rel).read_text(encoding="utf-8"))]
    assert stale == [], f"{stale} no longer open SQLite directly — drop them from _SEAM_EXEMPT"

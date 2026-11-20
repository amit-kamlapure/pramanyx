"""The coworker goes ahead only with what the platform itself says goes ahead (one rule for both places, 2026-11-20).

Until then its browser-side plugin kept a list of its own (`OWN_WORK`), held here against the platform's levels. It now
reads the platform's rows (`GET /abilities`, `pramanyx/abilities.py`) and keeps no list; its tests read a snapshot of
those rows, held here to the rows themselves so the snapshot cannot drift from what the platform says."""
from __future__ import annotations

import json
from pathlib import Path

from pramanyx import abilities

HOME = Path(__file__).resolve().parents[2] / "coworker" / "plugins" / "home"


def test_the_coworker_keeps_no_list_of_its_own_and_reads_the_platforms():
    source = (HOME / "lib" / "index.js").read_text()
    assert "OWN_WORK" not in source
    assert "/abilities" in source and "abilitiesOf" in source


def test_the_coworkers_snapshot_of_the_rows_is_the_rows():
    snapshot = json.loads((HOME / "test" / "abilities.fixture.json").read_text())
    assert snapshot == {"abilities": abilities.as_rows()}, (
        "the coworker's test snapshot is stale: write it again from pramanyx.abilities.as_rows()")


def test_nothing_that_changes_something_goes_ahead_without_asking_or_a_card():
    goes = {a.name for a in abilities.ABILITIES.values() if abilities.allowed(a) == "goes_ahead"}
    acts = {a.name for a in abilities.ABILITIES.values() if a.needs == "act"}
    # a file the person attached becomes their own private sheet: the attaching was the asking; a cosmetic setting of
    # their own is applied and undone the same way; a high-confidence note on one column carries its evidence
    assert goes & acts == {"bring_in_file", "set_preference", "propose_context_note"}

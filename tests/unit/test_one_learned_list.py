"""One learned list (the Atlas plan's A3b, 2026-11-26): Memory's remembered readings and reviewers' verdicts stand in
the same list as answers, findings, usage, trusted queries and fixes — one standing, one Promote — and a person's own
reading stays theirs."""
from __future__ import annotations

from types import SimpleNamespace as NS


def test_readings_and_verdicts_join_the_learned_list(monkeypatch):
    from pramanyx.knowledge import learned as L
    monkeypatch.setattr("pramanyx.semantic.ambiguity_ledger.list_resolutions", lambda conn, org_id="": [
        NS(id="r1", subject="active customer", resolved_reading="ordered in the last 90 days", resolution_source="probe",
           resolved_sql="SELECT * FROM orders", created_at="2026-11-20T10:00:00", use_count=4, person=""),
        NS(id="r2", subject="my region", resolved_reading="EMEA", resolution_source="user", resolved_sql="",
           created_at="2026-11-21T10:00:00", use_count=1, person="user:ana")])
    monkeypatch.setattr("pramanyx.feedback.verdicts.list_corrections", lambda conn, limit=200: [
        {"id": 7, "verdict": "reject", "headline": "Revenue fell 12%", "note": "it counted cancelled orders",
         "corrected_sql": "SELECT SUM(x) FROM order_items WHERE status != 'Cancelled'", "created_at": "2026-11-22T10:00:00"}])
    got = L._memory("c1")
    assert [(i["kind"], i["text"]) for i in got] == [
        ("reading", "“active customer” reads as ordered in the last 90 days"),
        ("verdict", "Marked wrong: Revenue fell 12% — it counted cancelled orders")], "a person's own reading stays theirs"
    reading, verdict = got
    assert reading["source"] == "settled by a probe of the data" and reading["standing"] == "measured" and reading["uses"] == 4
    assert reading["tables"] == ["orders"] and verdict["tables"] == ["order_items"]
    assert verdict["standing"] == "approved" and verdict["ref"] == "verdict:7"

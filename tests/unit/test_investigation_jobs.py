"""Investigations as first-class kernel jobs (T3 completion).

`_investigation_job_streamed` runs the (unchanged) `_stream_investigation`
generator INSIDE a supervised kernel job and bridges its SSE events to the client
over a queue — so a live investigation gets a job.state lifecycle, heartbeat,
kernel cancel, and job-stamped artifacts. Verified live (job PENDING→RUNNING→
SUCCEEDED, and cancel → CANCELLED + reconcile); these lock the mechanics.
"""
import asyncio

import pramanyx.routers.investigations as inv_mod








def test_cancel_route_maps_investigation_to_its_job(monkeypatch):
    # the inv→job link is read from the journal's job-stamped investigation.created
    events = [{"job_id": "jX", "payload": {"investigation_id": "invA"}},
              {"job_id": "jY", "payload": {"investigation_id": "invB"}}]

    import pramanyx.kernel.ledger as ledger_mod

    # a row its door made as it claimed the question was created outside any job: its job's payload names it
    jobs = [{"id": "jZ", "payload": {"investigation_id": "invC", "question": "q"}}]

    class _L:
        def events(self, **kw):
            assert kw.get("kind") == "investigation.created"
            return events + [{"job_id": None, "payload": {"investigation_id": "invC"}}]

        def jobs_where(self, **kw):
            assert kw.get("kinds") == ["investigation"]
            return jobs

    monkeypatch.setattr(ledger_mod.Ledger, "default", classmethod(lambda cls: _L()))
    assert inv_mod._job_id_for_investigation("invB") == "jY"
    assert inv_mod._job_id_for_investigation("invC") == "jZ"
    assert inv_mod._job_id_for_investigation("missing") is None


# ── crash-recovery (Increment B): boot-salvage ────────────────────────────────

def _stub_agent(monkeypatch, checkpoint_values):
    """Make build_graph_generic + open_connection_for return stubs whose checkpoint
    holds `checkpoint_values`, so salvage_orphaned_investigation can run hermetically."""
    from types import SimpleNamespace
    import pramanyx.agent.graph as graph_mod

    class _DB:
        def close(self): pass

    # Salvage now opens via ExecutionScope.open(), which imports from the canonical source —
    # patch there (not the router re-export) so the stub takes.
    monkeypatch.setattr("pramanyx.db.connection.open_connection_for", lambda cid: _DB())
    agent = SimpleNamespace(get_state=lambda cfg: SimpleNamespace(values=checkpoint_values))
    monkeypatch.setattr(graph_mod, "build_graph_generic", lambda db, hitl=False: agent)








def test_the_investigate_door_is_the_one_door_at_deep_depth(monkeypatch):
    """2026-11-27: `/investigate` went straight to the older graph engine, past the router; it is `/ask` at deep depth,
    carrying what the request carries."""

    from pramanyx.routers import investigations as inv
    seen: dict = {}

    async def fake_stream(req, request):
        seen.update(req.model_dump(by_alias=True))
        yield 'data: {"type": "done"}\n\n'
    monkeypatch.setattr(inv, "build_ask_stream", fake_stream)
    req = inv.InvestigateRequest(question="why did returns rise?", connection_id="c1", seed_sql="SELECT 1",
                                 seed_context="a fact", skip_cache=True)
    resp = asyncio.run(inv.investigate(req, None))

    async def drain():
        return [c async for c in resp.body_iterator]
    asyncio.run(drain())
    assert seen["depth"] == "deep" and seen["mode"] == "investigate"
    assert (seen["seed_sql"], seen["seed_context"], seen["skip_cache"]) == ("SELECT 1", "a fact", True)


def test_boot_ends_an_orphaned_run_as_failed_with_why(monkeypatch):

    from pramanyx import api
    from pramanyx.db import history
    ended: list = []
    monkeypatch.setattr(history, "list_orphaned_running_investigations",
                        lambda: [{"id": "inv9", "connection_id": "c1", "question": "q"}])
    monkeypatch.setattr(history, "fail_investigation", lambda inv_id, **k: ended.append((inv_id, k)))
    asyncio.run(api._recover_orphaned_investigations())
    assert ended and ended[0][0] == "inv9" and ended[0][1]["status"] == "failed" and "restarted" in ended[0][1]["reason"]

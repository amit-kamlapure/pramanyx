"""The dashboards study's R21 — a published dashboard on a rhythm. Nothing here leaves the machine: every send is a stand-in."""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from pramanyx.briefing import delivery as D
from pramanyx.briefing.models import BriefSubscription
from pramanyx.dashboards import sharing, subscribe as S
from pramanyx.routers import briefs

SPEC = {"root": "r", "elements": {
    "r": {"props": {"title": "Sales"}, "children": ["c1", "c2", "c3"]},
    "c1": {"type": "Card", "props": {"card": "rev", "title": "Revenue"}, "children": []},
    "c2": {"type": "Card", "props": {"card": "list"}, "children": []},
    "c3": {"type": "Card", "props": {"card": "off", "title": "Stock"}, "children": []},
}}
COVERS = "2026-10-01 to 2026-10-31"
RUNS = {
    "rev": {"value": 341000.5, "rows": [[341000.5]], "columns": ["v"], "scoped": {"standing": False}},
    "list": {"value": None, "rows": [["Email", 3], ["Search", 5]], "columns": ["channel", "n"], "row_count": 2, "scoped": {"standing": False}},
    "off": {"value": 12, "rows": [[12]], "columns": ["v"], "scoped": {"standing": True, "why": "it has no date"}},
}


def _sub(**kw) -> BriefSubscription:
    return BriefSubscription(**{"id": "s1", "conn_id": "c", "name": "Sales monthly", "period": "month", "content": "dashboard", "dashboard": "sales",
                                "dashboard_owner": "ana", "reader": "user:ana", "file_format": "pdf", **kw})


@pytest.fixture
def published(monkeypatch):
    import pramanyx.briefing.ranges as ranges
    import pramanyx.cards.store as store
    monkeypatch.setattr(sharing, "read_shared", lambda *_a, **_k: {"read": {"spec": SPEC, "version": 4}})
    monkeypatch.setattr(ranges, "resolve_for", lambda *_a, **_k: (SimpleNamespace(start=date(2026, 10, 1)), ""))
    monkeypatch.setattr(ranges, "phrases", lambda _s: {"covers": COVERS})
    monkeypatch.setattr(store, "get_card", lambda cid: SimpleNamespace(title="Orders by channel") if cid == "list" else None)
    monkeypatch.setattr(S, "_read_card", lambda cid, *_a: RUNS[cid])
    monkeypatch.setattr(S.build_departure, "__kwdefaults__", {"read": lambda cid, *_a: RUNS[cid]})


def test_each_figure_is_said_with_the_period_it_was_read_for(published):
    built = S.build_departure(_sub())
    assert f"Revenue: 341,000.5 ({COVERS})" in built["markdown"]
    assert f"Orders by channel: 2 rows ({COVERS})" in built["markdown"]
    assert f"Stock: 12 (as written, not cut to {COVERS})" in built["markdown"]         # a card that could not be cut says so
    data, name, media = built["file"]
    assert data.startswith(b"%PDF") and name == "sales.pdf" and media == "application/pdf"


def test_it_leaves_as_a_picture_when_asked(published):
    data, name, media = S.build_departure(_sub(file_format="png"))["file"]
    assert data.startswith(b"\x89PNG") and name == "sales.png" and media == "image/png"


def test_a_line_the_departure_laws_hold_is_cut_and_counted(published, monkeypatch):
    import pramanyx.govern.departure as G
    monkeypatch.setattr(G, "line_holds", lambda line, **_k: ["no approved definition"] if line.startswith("Revenue") else [])
    built = S.build_departure(_sub())
    assert "Revenue:" not in built["markdown"] and "1 held at departure" in built["markdown"]
    assert built["held_lines"][0].endswith("no approved definition")


def test_a_dashboard_no_longer_published_to_the_reader_is_not_sent(monkeypatch):
    def refuse(*_a, **_k):
        raise sharing.Refused("This dashboard is not shared with you.")
    monkeypatch.setattr(sharing, "read_shared", refuse)
    with pytest.raises(ValueError, match="not shared with you"):
        S.build_departure(_sub())


def _gate(monkeypatch, held=False):
    import pramanyx.govern.departure as G
    verdict = SimpleNamespace(held=held, record_id="d1", receipt={}, receipt_line=lambda: "Receipt d1", reason_sentence=lambda: "a figure could not be grounded")
    monkeypatch.setattr(G, "gate_departure", lambda **k: verdict)


def test_a_send_the_gate_holds_does_not_leave(published, monkeypatch):
    import pramanyx.automations.email as E
    _gate(monkeypatch, held=True)
    sent = []
    monkeypatch.setattr(E, "send_email", lambda *a, **k: sent.append(a) or (True, "sent"))
    result = {"status": "failed", "error": None}
    D._deliver_dashboard(_sub(email_to="reader@example.com"), None, result)
    assert result["status"] == "held" and sent == [] and "held at departure" in result["error"]


def test_by_email_it_carries_the_file_and_the_receipt(published, monkeypatch):
    import pramanyx.automations.email as E
    _gate(monkeypatch)
    sent = {}
    monkeypatch.setattr(E, "send_email", lambda to, subject, body, **k: sent.update(to=to, subject=subject, body=body, **k) or (True, "sent"))
    result = {"status": "failed", "error": None}
    D._deliver_dashboard(_sub(email_to="reader@example.com"), None, result)
    assert result["status"] == "ok" and sent["to"] == "reader@example.com" and sent["subject"] == f"Sales · {COVERS}"
    assert sent["body"].endswith("Receipt d1") and sent["attachment"][1] == "sales.pdf"


def test_to_slack_the_words_are_posted_and_the_file_follows_in_their_thread(published, monkeypatch):
    import pramanyx.slackbots.post as P
    import pramanyx.slackbots.store as B
    _gate(monkeypatch)
    monkeypatch.setattr(B, "get_bot_decrypted", lambda _b: SimpleNamespace(bot_token="t", enabled=True, name="Bot"))
    monkeypatch.setattr(P, "post_as_bot", lambda *a, **k: (True, {"channel": "C1", "ts": "1.2"}))
    uploaded = {}
    monkeypatch.setattr(P, "upload_file", lambda token, channel, **k: uploaded.update(channel=channel, **k) or (True, {}))
    result = {"status": "failed", "error": None}
    D._deliver_dashboard(_sub(bot_id="b1", channel="#sales"), None, result)
    assert result["status"] == "ok" and uploaded["channel"] == "C1" and uploaded["thread_ts"] == "1.2" and uploaded["filename"] == "sales.pdf"


def test_a_preview_builds_it_and_sends_nothing(published, monkeypatch):
    import pramanyx.automations.email as E
    monkeypatch.setattr(E, "send_email", lambda *a, **k: pytest.fail("a preview sent an email"))
    out = D.preview_subscription(_sub(email_to="reader@example.com"))
    assert out["sent"] is False and out["status"] == "preview" and COVERS in out["markdown"] and "file" not in out


def test_a_row_of_another_content_is_written_as_it_always_was():
    row = BriefSubscription(id="s", conn_id="c", name="n").to_dict()
    assert not {"dashboard", "dashboard_owner", "file_format", "email_to"} & set(row)


def _body(**kw):
    return briefs._SubscriptionBody(**{"conn_id": "c", "name": "n", "period": "month", "content": "dashboard", "dashboard": "sales", "file_format": "pdf", **kw})


def test_a_person_subscribes_only_to_a_published_version_they_may_read(monkeypatch):
    import pramanyx.dashboards.home as H
    monkeypatch.setattr(H, "person_of", lambda _r: "ana")
    monkeypatch.setattr(sharing, "read_shared", lambda *_a, **_k: {"read": {}})
    assert briefs._dashboard_reader(_body(), None) == ("ana", "ana")
    with pytest.raises(HTTPException, match="PDF or a PNG"):
        briefs._dashboard_reader(_body(file_format="gif"), None)

    def refuse(*_a, **_k):
        raise sharing.Refused("This App has no published version to read.")
    monkeypatch.setattr(sharing, "read_shared", refuse)
    with pytest.raises(HTTPException) as got:
        briefs._dashboard_reader(_body(), None)
    assert got.value.status_code == 422 and "no published version" in got.value.detail


@pytest.mark.parametrize("kw, says", [
    ({"email_to": "not an address"}, "not an email address"),
    ({"email_to": "a@example.com", "content": "briefing"}, "only a dashboard subscription goes by email"),
])
def test_an_address_is_held_to_its_shape(kw, says):
    with pytest.raises(HTTPException) as got:
        briefs._validate_destination(_body(**kw))
    assert says in got.value.detail

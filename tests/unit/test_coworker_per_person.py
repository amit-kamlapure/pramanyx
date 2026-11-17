"""Each person's own coworker (2026-11-17; the user: "Each user must get its own co-worker").

Receipts: with sign-in, the door gives each person only their own coworker's address, never another's or the
install's first; `POST /coworker/mine` starts a person's coworker once, in its own home on its own port, as theirs, and
asks again only once it has stopped; an agent cannot start one. Without sign-in the install has one person, and the
coworker start_all.sh starts is theirs, as before. Process starts are stood in; nothing here runs a shell.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx import coworkers as K
from pramanyx.routers import coworker as C
from pramanyx.security.authz import Principal


class _Started:
    """A stand-in for starting a coworker's process: records how it was started; alive until told otherwise."""
    seen: list = []
    next_pid = 40000

    @staticmethod
    def start(argv, *, cwd, env, log):
        _Started.next_pid += 1
        _Started.seen.append({"argv": argv, "cwd": cwd, "env": env, "pid": _Started.next_pid})
        return _Started.next_pid


@pytest.fixture()
def install(tmp_path, monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(K, "_now", lambda: clock["t"])
    monkeypatch.setattr(K, "_announced", {})
    monkeypatch.setenv("PRAMANYX_COWORKER_HOME_ROOT", str(tmp_path / "coworker"))
    shell = tmp_path / "shell" / "node_modules" / ".bin"
    shell.mkdir(parents=True)
    (shell / "dsh").write_text("")
    monkeypatch.setenv("PRAMANYX_COWORKER_SHELL", str(tmp_path / "shell"))
    _Started.seen = []
    monkeypatch.setattr(K, "_start", _Started.start)
    alive: set = set()
    monkeypatch.setattr(K, "_alive", lambda pid: pid in alive)
    monkeypatch.setattr(K, "_listening", lambda port: False)
    monkeypatch.setenv("PRAMANYX_REQUIRE_IDENTITY", "1")
    who = {"user": "ana"}
    import pramanyx.security.authz as authz
    monkeypatch.setattr(authz, "get_principal", lambda request: Principal(user_id=who["user"], org_id="default")
                        if who["user"] else None)
    app = FastAPI()
    app.include_router(C.router)
    client = TestClient(app, client=("127.0.0.1", 50000))
    return {"client": client, "who": who, "alive": alive, "clock": clock, "root": tmp_path / "coworker"}


def test_each_person_is_given_only_their_own_coworker(install):
    client, who = install["client"], install["who"]
    client.put("/coworker/address", json={"url": "http://127.0.0.1:3090/?token=first"})              # the install's first
    client.put("/coworker/address", json={"url": "http://127.0.0.1:3101/?token=ana", "person": "ana"})
    assert client.get("/coworker").json()["url"] == "http://127.0.0.1:3101/?token=ana"
    who["user"] = "bo"
    got = client.get("/coworker").json()
    assert got["available"] is False and got["url"] is None and got["can_start"] is True


def test_a_persons_coworker_is_started_once_in_its_own_home_and_port_as_theirs(install):
    client, who, alive = install["client"], install["who"], install["alive"]
    first = client.post("/coworker/mine").json()
    assert first["starting"] is True and first["available"] is False
    [ana] = _Started.seen
    alive.add(ana["pid"])
    assert ana["argv"][0] == "sh" and ana["argv"][1].endswith("coworker/start.sh")
    assert ana["env"]["PRAMANYX_COWORKER_PERSON"] == "ana" and ana["env"]["PORT"] == str(K.FIRST_PORT)
    assert ana["env"]["DSH_HOME"] == str(install["root"] / "people" / K.person_key("ana"))
    assert "ana" not in ana["env"]["DSH_HOME"], "no name lands in a path"
    assert "PRAMANYX_DELEGATION_FILE" not in ana["env"], "each coworker keeps its person in its own home"

    assert client.post("/coworker/mine").json()["starting"] is True       # still starting: not started twice
    assert len(_Started.seen) == 1

    who["user"] = "bo"
    client.post("/coworker/mine")
    bo = _Started.seen[-1]
    assert bo["env"]["PRAMANYX_COWORKER_PERSON"] == "bo" and bo["env"]["PORT"] == str(K.FIRST_PORT + 1)
    assert bo["env"]["DSH_HOME"] != ana["env"]["DSH_HOME"]

    # Once Ana's says where it is, she is sent there; once it has stopped, asking starts it again on the same port.
    client.put("/coworker/address", json={"url": f"http://127.0.0.1:{K.FIRST_PORT}/?token=a", "person": "ana"})
    who["user"] = "ana"
    assert client.post("/coworker/mine").json() == {"available": True, "url": f"http://127.0.0.1:{K.FIRST_PORT}/?token=a",
                                                     "can_start": True, "starting": False, "reason": ""}
    install["clock"]["t"] += K.FRESH_FOR + 1
    alive.discard(ana["pid"])
    client.post("/coworker/mine")
    assert _Started.seen[-1]["env"]["PORT"] == str(K.FIRST_PORT)


def test_an_agent_cannot_start_a_coworker_and_nobody_is_started_without_a_person(install, monkeypatch):
    client = install["client"]
    import pramanyx.rbac.agent_gate as gate
    monkeypatch.setattr(gate, "is_agent_request", lambda request: True)
    assert client.post("/coworker/mine").status_code == 403
    assert K.ensure("")["state"] == "unavailable"
    assert _Started.seen == []


def test_without_sign_in_the_installs_first_coworker_is_the_one_persons(install, monkeypatch):
    client = install["client"]
    monkeypatch.delenv("PRAMANYX_REQUIRE_IDENTITY")
    client.put("/coworker/address", json={"url": "http://127.0.0.1:3090/?token=first"})
    assert client.get("/coworker").json()["url"] == "http://127.0.0.1:3090/?token=first"
    got = client.post("/coworker/mine").json()
    assert got["available"] is True and _Started.seen == [], "none is started: the one coworker is theirs"

"""Each person's own coworker (2026-11-17; the user: "Each user must get its own co-worker.. like everyone having their
own claude desktop yet connected to same platform underneath").

A coworker is a shell process (`coworker/start.sh`) with its own home — its conversations, its attachments, its search
index, the person it acts for — and its own port. One shell held one person at a time, and every person on an install
shared its conversations. Now each person who opens the coworker gets their own, started here the first time they ask,
and the door (`GET /coworker`) gives each person only the address of theirs. Nobody sees another person's
conversations; a conversation more than one person works in is a group conversation, which people are added to.

An install without sign-in has one person: the coworker `scripts/start_all.sh` starts (the install's first, which
announces no owner) is theirs, as it always was, with every conversation in it. With sign-in, that first coworker is
nobody's new coworker; each person's is started under ``<coworker home>/people/<key>/``.

What is kept: which port each person's coworker has, in ``people/registry.json``. A coworker says where it is every
half minute (`PUT /coworker/address`), with whose it is; an address not said for two minutes is not given out.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
import time
from pathlib import Path
from typing import Optional

#: How long an announcement stands: a coworker says where it is every 30 seconds; four missed is gone.
FRESH_FOR = 120.0
#: The ports people's coworkers are given, after the install's first (3090) and the stock shell kept beside it (3091).
FIRST_PORT, LAST_PORT = 3101, 3199

#: person ("" for the install's first coworker, which announces no owner) → {url, at}
_announced: dict[str, dict] = {}


def _now() -> float:
    """A seam, so a test moves the clock."""
    return time.monotonic()


def home_root() -> Path:
    return Path(os.getenv("PRAMANYX_COWORKER_HOME_ROOT") or (Path.home() / ".pramanyx" / "coworker"))


def shell_bin() -> Path:
    root = Path(os.getenv("PRAMANYX_COWORKER_SHELL") or (Path.home() / ".pramanyx" / "coworker-shell"))
    return root / "node_modules" / ".bin"


def start_script() -> Path:
    return Path(__file__).resolve().parent.parent / "coworker" / "start.sh"


def person_key(person: str) -> str:
    """A person's coworker folder: a digest of who they are, so no name lands in a path."""
    return hashlib.sha1(person.strip().lower().encode()).hexdigest()[:16]


def announce(url: str, person: str = "") -> None:
    _announced[person or ""] = {"url": url, "at": _now()}


def address_of(person: str, *, single_person: bool) -> Optional[str]:
    """The address of ``person``'s own coworker, while it says it is running. On an install without sign-in the
    install's first coworker is the one person's."""
    for who in ([person] if person else []) + ([""] if single_person else []):
        said = _announced.get(who)
        if said and _now() - said["at"] <= FRESH_FOR:
            return said["url"]
    return None


# ── starting a person's own ──────────────────────────────────────────────────────────────────────────────────────


def _registry_path() -> Path:
    return home_root() / "people" / "registry.json"


def _registry() -> dict:
    try:
        return json.loads(_registry_path().read_text())
    except (OSError, ValueError):
        return {}


def _save(reg: dict) -> None:
    path = _registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(reg, indent=1, sort_keys=True))
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def _listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _alive(pid: Optional[int]) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False


def _free_port(reg: dict) -> int:
    taken = {int(r.get("port") or 0) for r in reg.values()}
    for port in range(FIRST_PORT, LAST_PORT + 1):
        if port not in taken and not _listening(port):
            return port
    raise RuntimeError(f"every coworker port from {FIRST_PORT} to {LAST_PORT} is taken")


def _start(argv: list[str], *, cwd: str, env: dict, log) -> int:
    """Start a coworker's process on its own (a seam: a test stands in for it); its pid."""
    return subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True).pid


def ensure(person: str) -> dict:
    """``person``'s own coworker: ``{"state": "running", "url"}`` when it says where it is, ``{"state": "starting"}``
    while it starts (started now if it was not), or ``{"state": "unavailable", "reason"}``."""
    if not person:
        return {"state": "unavailable", "reason": "A coworker is started for a signed-in person."}
    url = address_of(person, single_person=False)
    if url:
        return {"state": "running", "url": url}
    bin_dir, script = shell_bin(), start_script()
    if not (bin_dir / "dsh").exists():
        return {"state": "unavailable", "reason": f"The coworker's shell is not installed at {bin_dir.parent.parent}."}
    if not script.exists():
        return {"state": "unavailable", "reason": "This install has no coworker/start.sh."}
    reg = _registry()
    key = person_key(person)
    mine = reg.get(key) or {}
    if _alive(mine.get("pid")):
        return {"state": "starting"}
    home = home_root() / "people" / key
    home.mkdir(parents=True, exist_ok=True)
    port = int(mine.get("port") or 0) or _free_port(reg)
    env = {**os.environ, "DSH_HOME": str(home), "PORT": str(port), "PRAMANYX_COWORKER_PERSON": person,
           "PRAMANYX_DSH": str(bin_dir / "dsh"), "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"}
    for inherited in ("PRAMANYX_DELEGATION_FILE", "PRAMANYX_CLOCK_FILE", "PRAMANYX_ATTACHMENTS_DIR"):
        env.pop(inherited, None)     # each coworker keeps these in its own home (start.sh's defaults)
    log = open(home / "coworker.log", "ab")  # noqa: SIM115 — the child keeps it open for its life
    pid = _start(["sh", str(script)], cwd=str(home), env=env, log=log)
    log.close()
    reg[key] = {"person": person, "port": port, "home": str(home), "pid": pid, "started": time.time()}
    _save(reg)
    return {"state": "starting"}


def people() -> list[dict]:
    """The people's coworkers this install has started, and whether each is running — for an operator."""
    return [{"port": r.get("port"), "running": _alive(r.get("pid")) and _listening(int(r.get("port") or 0)),
             "started": r.get("started")} for r in _registry().values()]

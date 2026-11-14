"""Every model call belongs to a run: work that starts one where none is open opens it here.

Measured 2026-11-14: 373 model calls over two days were filed under no run at all (`untraced:request:<day>`), 350 of
them a custom agent's — its quality check runs each certified question through the answer path, and nothing opened a
trace around it — and the rest the platform's own agent loop called from a sheet's chat or a dashboard. A call under
no run cannot be read back as part of anything: Agent Ops lists it nowhere, and its spend belongs to no one.

`own_run` opens a run only when none is open, so work started inside a request or a job keeps the trace it has. The
run it opens is recorded the way a request's is: what it was asked, then how it ended.
"""
from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from typing import Iterator


@contextmanager
def own_run(kind: str, what: str, *, conn_id: str = "") -> Iterator[str]:
    """Run the enclosed block under a trace of its own when none is open; yield the trace it runs under."""
    from pramanyx import telemetry
    ambient = telemetry.current_trace_id()
    if ambient:
        yield ambient
        return
    from pramanyx.obs import session_log
    run_id = f"{kind}-{uuid.uuid4().hex[:10]}"
    started = time.monotonic()
    failed = ""
    with telemetry.bind_trace(run_id), telemetry.bind_run(run_id, kind):
        session_log.emit(session_log.USER_REQUEST, name=kind, trace_id=run_id, conn_id=conn_id or None,
                         payload={"question": (what or kind)[:2000], "started_by": kind})
        try:
            yield run_id
        except BaseException as exc:
            failed = f"{type(exc).__name__}: {exc}"[:2000]
            raise
        finally:
            session_log.emit(session_log.FINAL_RESPONSE, name=kind, trace_id=run_id, conn_id=conn_id or None,
                             ok=not failed, duration_ms=round((time.monotonic() - started) * 1000, 1),
                             payload={"headline": "ended" if not failed else "", **({"error": failed} if failed else {})})

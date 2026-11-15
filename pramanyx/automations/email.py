"""An automation's answer, sent as email (2026-11-15: the user asked for a scheduled summary by email).

Until this the platform could not send email at all: the Google connection read Gmail, and no SMTP was configured.
This is the smallest correct sender — through the organisation's own Google connection, as the account that
connected it, with Gmail's narrowest sending scope (``gmail.send``, its own product on the Google card, so reading
mail and sending it are two Google permissions, chosen on the one Gmail card, never one riding in on the other).

* **The recipient is the step's, set by a person** (`models._EFFECT_REQUIRED["email"]`), never bound from an upstream
  step: what an answer says must not choose who receives it.
* **The words are the answer's**, rendered as the Slack post renders it (headline, body, the grid once, the top
  caveats), and they pass the same departure gate (`engine._dispatch_email`).
* **The send is an outside call** (`govern/outbound.external_call`): checked against the usage caps before it leaves,
  a span in the run's trace, an event that counts it.
* **No Google connection that may send** is said, with what to do — never a quiet skip.
"""
from __future__ import annotations

import base64
import re
from email.message import EmailMessage
from typing import Optional

import httpx

SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
_ADDRESS = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


def email_text(effect, automation, rendered: str) -> tuple[str, str]:
    """The subject and body: the step's own subject, else the automation's name; the rendered answer as the body."""
    subject = str(effect.config.get("subject") or "").strip() or (automation.name or "Pramanyx")
    body = (rendered or "").strip() or str(effect.config.get("message") or "").strip()
    return subject[:200], body


def sending_connection(connection_id: str = "") -> tuple[Optional[str], str]:
    """The Google connection that may send, or (None, why not)."""
    from pramanyx.integrations.store import get_connection, list_connections
    candidates = [get_connection(connection_id)] if connection_id else list_connections()
    for c in candidates:
        if c is not None and c.provider == "google" and SEND_SCOPE in (c.scopes or "").split():
            return c.id, ""
    return None, ("no Google connection may send email: on the Google card in Settings ▸ Integrations, connect Gmail "
                  "and choose Send, which asks Google for permission to send as that account")


def send_email(to: str, subject: str, body: str, *, connection_id: str = "") -> tuple[bool, str]:
    """Send one plain-text email. Returns (sent, the sentence that says what happened)."""
    to = (to or "").strip()
    if not _ADDRESS.match(to):
        return False, f"not an email address: {to or '(none)'}"
    if not body:
        return False, "nothing to send: the step had no answer to put in the email"
    conn_id, why = sending_connection(connection_id)
    if conn_id is None:
        return False, why
    from pramanyx.govern.outbound import OutboundBlocked, external_call
    from pramanyx.integrations.broker import fresh_access_token
    msg = EmailMessage()
    msg["To"], msg["Subject"] = to, subject
    msg.set_content(body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    try:
        token = fresh_access_token(conn_id)
        with external_call("gmail", "messages.send") as extra:
            r = httpx.post(_SEND_URL, json={"raw": raw}, headers={"Authorization": f"Bearer {token}"}, timeout=20)
            extra["status"] = r.status_code
    except OutboundBlocked as exc:
        return False, f"a usage cap stopped the email: {exc.reason}"
    except Exception as exc:  # noqa: BLE001 — a failed send is said on the run, with its cause
        return False, f"the email could not be sent ({type(exc).__name__}: {str(exc)[:160]})"
    if r.status_code >= 300:
        detail = ""
        try:
            detail = str(((r.json() or {}).get("error") or {}).get("message") or "")
        except ValueError:
            detail = r.text[:160]
        return False, f"Gmail refused the email ({r.status_code}): {detail[:200]}"
    return True, f"sent to {to}"

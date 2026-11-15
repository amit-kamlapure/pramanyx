"""`POST /email/send` — an email a person wrote, sent when they press Send (2026-11-15).

The coworker drafts; a person edits and sends. The rule the user set for verdicts holds here too: only a person's own
click speaks for them, so a request carrying the agent mark is refused — the agent's tool (`draft_email`) returns a
draft and never reaches this door. The departure gate is not asked: a person read these words and pressed Send, and
the person is the gate there (as the inbox's accepted send is, `automations.engine`). What left is journaled —
``email.sent``, with who sent it, to whom, the subject and the outcome — because it left.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["email"])


class EmailBody(BaseModel):
    to: str = Field(max_length=320, description="One address.")
    subject: str = Field(default="", max_length=300)
    body: str = Field(max_length=100_000)


@router.post("/email/send")
def send_an_email(email: EmailBody, request: Request):
    """Send one email as the organisation's connected Google account. Answers ``{sent, said}`` — the sentence the
    person is shown, success or why not."""
    from pramanyx.automations.email import send_email
    from pramanyx.rbac.agent_gate import is_agent_request
    from pramanyx.security.authz import acting_person, get_principal
    if is_agent_request(request):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="An email is sent by a person pressing Send; an agent can only draft one.")
    who = acting_person(get_principal(request))
    sent, said = send_email(email.to, email.subject.strip() or "From Pramanyx", email.body.strip())
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit("email.sent", {"by": who, "to": email.to.strip(), "subject": email.subject.strip()[:300],
                                             "sent": sent, "said": said})
    except Exception as exc:  # noqa: BLE001 — the send happened or did not; the journal line is its record
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "an email's journal line was not written", counter="email.journal")
    return {"sent": sent, "said": said}

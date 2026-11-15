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
    #: The analysis to attach, by its id, and as what (pdf · xlsx · docx · pptx); both empty for none.
    attach_answer: str = Field(default="", max_length=64)
    attach_format: str = Field(default="", max_length=8)
    #: The draft this email was written from, as the page that holds it names it — so that page can say "sent" after
    #: it is reloaded (`GET /email/sent`). A name, never content; "" for an email written from no draft.
    draft: str = Field(default="", max_length=80, pattern=r"^[A-Za-z0-9:_.-]*$")


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
    attachment = None
    if email.attach_format or email.attach_answer:
        # The analysis is the caller's to send only if it is theirs to read (SEC-05), and an email asked to carry it
        # never goes without it.
        from pramanyx.automations.email import answer_attachment
        from pramanyx.security.authz import check_owner
        check_owner("investigation", email.attach_answer, get_principal(request))
        attachment, why = answer_attachment(email.attach_answer, email.attach_format)
        if attachment is None:
            return {"sent": False, "said": why}
    sent, said = send_email(email.to, email.subject.strip() or "From Pramanyx", email.body.strip(),
                            attachment=attachment)
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit("email.sent", {"by": who, "to": email.to.strip(), "subject": email.subject.strip()[:300],
                                             "sent": sent, "said": said,
                                             "attached": attachment[1] if attachment is not None else "",
                                             "draft": email.draft})
    except Exception as exc:  # noqa: BLE001 — the send happened or did not; the journal line is its record
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "an email's journal line was not written", counter="email.journal")
    return {"sent": sent, "said": said}


#: How far back the journal is read for one draft's sends: far more emails than an install sends between two reads.
SENT_LOOKBACK = 2000


@router.get("/email/sent")
def emails_sent(request: Request, draft: str = "", subject: str = ""):
    """What went out from one draft: the caller's own successful sends from it, newest first.

    Found live, 2026-11-15: an email sent minutes earlier showed as an open draft again, because "sent" lived only in
    the page that sent it and a reload forgot it. Whether an email went is a fact about the email, and the journal
    already records it (``email.sent``) — so the place a draft is shown asks here, and says the same thing every time
    it is opened. ``subject`` finds a send journaled before drafts were named, and only among the entries that name
    no draft: a later draft that happens to carry the same subject is never read as sent."""
    from pramanyx.kernel.ledger import Ledger
    from pramanyx.security.authz import acting_person, get_principal, tenant_scope
    name, wanted = draft.strip()[:80], subject.strip()[:300]
    if not name and not wanted:
        return {"sends": []}
    who = acting_person(get_principal(request))
    sends = []
    for event in Ledger.default().events(kind="email.sent", limit=SENT_LOOKBACK, org_id=tenant_scope()):
        said = event.get("payload") or {}
        if said.get("sent") is not True or said.get("by") != who:
            continue                                          # a refused send is not a send; another person's is theirs
        named = str(said.get("draft") or "")
        if (name and named == name) or (wanted and not named and str(said.get("subject") or "") == wanted):
            sends.append({"to": str(said.get("to") or ""), "subject": str(said.get("subject") or ""),
                          "at": str(event.get("at") or ""), "attached": str(said.get("attached") or "")})
    return {"sends": sends}

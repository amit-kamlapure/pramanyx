"""People's comments on a Definition (the user, 2026-11-25: "comments and votes on Definitions").

A comment is a ``said`` claim about the Definition, as a comment on a sheet's row is (`sheets/record.comment`): one
store for what people said about a thing. It is about the Definition's own key, so it stays with the Definition through
every rewording. In the commenter's name, never an agent's; a person may take back their own — withdrawn, its words
kept beneath it, never deleted. An ``@name`` in it is kept as who it mentions, and reaches them: a
``definition.mentioned`` event each, read into their Inbox's "For you" lane (`record/mentions`) — gone from it when
the comment is taken back.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Optional

from pramanyx.record import claims as _claims
from pramanyx.record.writers import definition_key, definition_term, definitions_of

#: ``@ana`` or ``@ana@example.com`` — who a comment mentions, as they sign in.
MENTION = re.compile(r"(?<![\w.@])@([A-Za-z0-9][A-Za-z0-9._%+-]*(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)")
#: How long a comment may be, in characters.
MOST = 2000


class NoSuchDefinition(LookupError):
    """There is no current Definition of that word in that Area on that connection."""


class NotTheirs(PermissionError):
    """Only the person who wrote a comment takes it back."""


def the_definition(connection_id: str, term: str, area: str) -> _claims.Claim:
    for d in definitions_of(connection_id, term):
        if definition_term(d.extra.get("area", "")) == definition_term(area):
            return d
    raise NoSuchDefinition(f'there is no Definition of "{term}"{f" in {area}" if area else ""} here')


def _person(ref: str) -> str:
    return str(ref or "").strip().lower().removeprefix("user:").removeprefix("person:")


def mentions_in(text: str) -> list[str]:
    """Who ``text`` mentions, each once, in the order mentioned."""
    out: list[str] = []
    for m in MENTION.finditer(text or ""):
        name = m.group(1).rstrip(".")
        if name and name.lower() not in (x.lower() for x in out):
            out.append(name)
    return out


def _key(connection_id: str, term: str, area: str, said_id: str) -> str:
    return _claims.claim_key("said", "definition", connection_id or "-", definition_term(term),
                             "in-" + definition_term(area) if definition_term(area) else "-", said_id)


def _view(c: _claims.Claim) -> dict:
    x = c.extra or {}
    return {"id": x.get("said_id", ""), "text": c.statement.text, "by": c.author, "at": str(x.get("at") or c.as_of),
            "mentions": list(x.get("mentions") or [])}


def comments(connection_id: str, term: str, area: str = "") -> list[dict]:
    """A Definition's comments, oldest first; a comment taken back is not among them."""
    ref = definition_key(connection_id, term, area)
    found = _claims.list_claims(kind="said", about_kind="object", about_key=ref, conn_id=connection_id or None,
                                limit=500)
    return sorted((_view(c) for c in found if c.state != "withdrawn"), key=lambda v: v["at"])


def comment(connection_id: str, term: str, area: str, text: str, *, by: str) -> dict:
    """Keep a person's comment on a Definition, in their name."""
    words = " ".join((text or "").split())[:MOST]
    if not words:
        raise ValueError("a comment needs words")
    d = the_definition(connection_id, term, area)
    at = datetime.now(timezone.utc).isoformat()
    said_id = hashlib.sha1(f"{by}|{at}|{words}".encode()).hexdigest()[:12]
    ref = definition_key(connection_id, term, area)
    name = d.extra.get("term", term)
    claim = _claims.Claim(
        kind="said", tier="said", about=_claims.About(kind="object", key=ref),
        statement=_claims.Statement(text=words), status="Provisional", as_of=at[:10],
        warrants=[_claims.said_warrant("conversation", f"{ref}/comment:{said_id}", words, shared=True,
                                       detail=f'said on the Definition "{name}"')],
        author=by, author_kind="person", state="open",
        extra={"writer": "definitions", "connection_id": connection_id, "term": name,
               "area": d.extra.get("area", area), "at": at, "said_id": said_id, "mentions": mentions_in(words)},
    )
    _claims.book(claim, key=_key(connection_id, term, area, said_id), conn_id=connection_id or None)
    from pramanyx.record.mentions import note_mentions
    note_mentions(claim.extra["mentions"], by=by, connection_id=connection_id, term=name,
                  area=d.extra.get("area", area), said_id=said_id, text=words)
    return _view(claim)


def is_open(connection_id: str, term: str, area: str, said_id: str) -> bool:
    """Whether that comment still stands — not taken back."""
    got = _claims.latest(_key(connection_id, term, area, said_id))
    return got is not None and got.state != "withdrawn"


def take_back(connection_id: str, term: str, area: str, said_id: str, *, by: str) -> Optional[str]:
    """Its writer takes a comment back: withdrawn, its words kept beneath it. None when there is none to take back."""
    key = _key(connection_id, term, area, said_id)
    prior = _claims.latest(key)
    if prior is None or prior.state == "withdrawn":
        return None
    if _person(prior.author) != _person(by):
        raise NotTheirs("only the person who wrote a comment takes it back")
    new = prior.model_copy(deep=True)
    new.state = "withdrawn"
    new.extra = {**prior.extra, "withdrawn_at": datetime.now(timezone.utc).isoformat()}
    return _claims.restate(key, new, conn_id=connection_id or None)

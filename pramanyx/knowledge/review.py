"""What waits on a person for a connection's knowledge, in one list (Phase 3, 2026-11-17).

A governed ontology keeps one review queue of gaps, learned candidates and conflicts. Here each of
those already lives in its own store with its own lifecycle, and this module stores nothing: it is a VIEW, read fresh
(the needs-human view's pattern), each row deep-linked to the page where it is decided.

- **Gaps** — what people asked that the knowledge did not cover: questions that framed on no definition
  (`ontology/framing_misses.py`), and questions no run could answer (`intake/suggestions.unresolved_questions`).
- **Candidates** — what was learned and waits for a person: the explorer's findings and the warehouse's mined usage
  nobody has confirmed (`knowledge/learned.py`), Definition drafts and suggested edits (`record/writers.py`), a
  model's proposed synonyms (`ontology/vocabulary.py`), an import's candidates (`intake/store.py`), and answers people
  marked wrong or unhelpful (`feedback/verdicts.py`, the ledger's `chat.feedback`).
- **Conflicts** — a word published with a different meaning in two areas (`semantic/areas.rival_groups`), and a
  question the platform has answered more than one way (`semantic/answer_divergence.detect`).

Each row is placed in an area where its source says one, and routed to that area's owners; the busiest first (how
often asked, how many complaints), then the newest. A source that could not be read is named, never taken for empty.
Use is counted only where a source counts it: a finding's uses are not recorded, and the row says so by having none.
"""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from typing import Callable, Optional
from urllib.parse import quote

#: How many rows of one source are listed (the count says how many there are).
PER_SOURCE = 60

KINDS = ("gap", "candidate", "conflict")


def _ref(text: str) -> str:
    """A row's id from its words: the same question is the same row on every read."""
    return hashlib.sha1(text.strip().lower().encode()).hexdigest()[:12]


def _row(*, source: str, ref: str, kind: str, title: str, detail: str = "", area: str = "", count: Optional[int] = None,
         complaints: int = 0, at: str = "", href: Optional[str], action: str, actions: Optional[list[dict]] = None) -> dict:
    return {"id": f"{source}:{ref}", "source": source, "kind": kind, "title": title.strip()[:300], "detail": detail,
            "area": area or "", "count": count, "complaints": complaints, "at": (at or "")[:19],
            "resolve": {"href": href, "action": action}, "actions": actions or []}


# ── what a row can be settled by, where it is shown (the Inbox, 2026-11-26) ─────────────────────────────────────────
# The reference opens a row for review beside the list with Accept · Edit and accept · Reject. A row says which of them
# it has, each the door that already settles it — never a new one: `call` is a request the page makes as the person,
# `open` a page it opens beside the list. A row with nothing to accept or reject (a gap, a conflict) says only what to
# write; every row may be set aside ("Not now"), which the page offers itself.

def _call(do: str, label: str, method: str, path: str, body: dict) -> dict:
    return {"do": do, "label": label, "call": {"method": method, "path": path, "body": body}}


def _definition_page(do: str, label: str, connection_id: str, term: str, area: str = "") -> dict:
    return {"do": do, "label": label, "open": {"definition": {"connection": connection_id, "term": term, "area": area}}}


def _new_definition(label: str, connection_id: str, term: str = "", area: str = "") -> dict:
    return {"do": "edit", "label": label, "open": {"new_definition": {"connection": connection_id, "term": term, "area": area}}}


def _page(label: str, href: str) -> dict:
    return {"do": "open", "label": label, "open": {"href": href}}


def _links(connection_id: str) -> dict[str, Callable[..., str]]:
    c = quote(connection_id, safe="")
    return {
        "definitions_tab": lambda: f"/?tab=semantic&semtab=definitions&conn={c}",
        # The areas are declared on the Metrics tab's coverage card, where the model's suggestions wait.
        "areas": lambda: f"/?tab=semantic&conn={c}",
        "import_tab": lambda: f"/?tab=semantic&semtab=import&conn={c}",
        "record": lambda: f"/?tab=record&conn={c}",
        # One claim, opened in the Record's reader — where it is confirmed or marked wrong.
        "claim": lambda claim_id: f"/?tab=record&layer=claims&id={quote(claim_id, safe='')}&conn={c}",
        "definition": lambda term, area="": (f"/definitions/{quote(term, safe='')}?conn={c}"
                                             + (f"&area={quote(area, safe='')}" if area else "")),
        # a new Definition's page, its word (and Area) filled in — the person writes what it means (A5)
        "new_definition": lambda term, area="": (f"/?tab=semantic&conn={c}&new_definition=1&term={quote(term, safe='')}"
                                                 + (f"&area={quote(area, safe='')}" if area else "")),
    }


# ── the sources ──────────────────────────────────────────────────────────────────────────────────────────────────


def _framing_misses(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.ontology.framing_misses import misses
    got = misses(connection_id, limit=500, keep=500)
    rows = got.get("recent") or []
    asked: Counter = Counter()
    last: dict[str, str] = {}
    own: Counter = Counter()
    unkept = got.get("misses", 0) - sum(1 for r in rows if r.get("question"))
    for r in rows:
        q = (r.get("question") or "").strip()
        if q and r.get("started_by"):
            # The platform's own run (an agent checked against its certified questions): its first event names the
            # run, not a question a person asked, so it is not listed as one (found on theLook's live list, 44 of them).
            own[str(r["started_by"])] += 1
        elif q:
            asked[q] += 1
            last[q] = max(last.get(q, ""), str(r.get("at") or ""))
    out = [_row(source="framing_miss", ref=_ref(q), kind="gap", title=q,
                detail="Framed on no definition: the words it used are not ones the business declared.",
                count=n, at=last[q], href=link["definitions_tab"](), action="Add the words it used",
                actions=[_new_definition("Define the words it used", connection_id)])
           for q, n in asked.most_common()]
    if own:
        n = sum(own.values())
        out.append(_row(source="framing_miss", ref="own-runs", kind="gap",
                        title=f"{n} question{'' if n == 1 else 's'} in the platform's own checks framed on no definition",
                        detail=f"From runs the platform started itself ({', '.join(sorted(own))}), such as an agent "
                               "checked against its certified questions — not questions a person asked.",
                        href=link["definitions_tab"](), action="See the questions"))
    if unkept > 0:
        out.append(_row(source="framing_miss", ref="unkept", kind="gap",
                        title=f"{unkept} more question{'' if unkept == 1 else 's'} framed on no definition",
                        detail="Their words are no longer kept by the session log; only that they missed is.",
                        count=unkept, href=link["definitions_tab"](), action="See what is still kept"))
    return out


def _unanswered(connection_id: str, link: dict) -> list[dict]:
    """Questions no run could answer, grouped by what was ASKED: a scheduled run carries a code-written preamble that
    names its date, so each of its runs read as a different question (theLook's live list, 2026-11-17)."""
    from pramanyx.automations.temporal import ask_of
    from pramanyx.intake.suggestions import unresolved_questions
    asked: dict[str, dict] = {}
    for r in unresolved_questions(connection_id, limit=500):
        raw = str(r.get("question") or "")
        ask = ask_of(raw).strip() or raw.strip()
        cur = asked.setdefault(ask.lower(), {"title": ask, "count": 0, "statuses": set(), "scheduled": 0})
        cur["count"] += int(r.get("count") or 0)
        cur["statuses"].update(r.get("statuses") or [])
        if ask != raw.strip():
            cur["scheduled"] += int(r.get("count") or 0)
    rows = sorted(asked.values(), key=lambda a: -a["count"])[:PER_SOURCE]
    return [_row(source="unanswered", ref=_ref(a["title"]), kind="gap", title=a["title"],
                 detail=f"No run could answer it ({', '.join(sorted(a['statuses'])) or 'not complete'})"
                        + (f"; {a['scheduled']} of them on a schedule." if a["scheduled"] else "."),
                 count=a["count"], href=link["definitions_tab"](), action="Define what it needs",
                 actions=[_new_definition("Define what it needs", connection_id)])
            for a in rows]


def _unconfirmed(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.knowledge.learned import learned_items
    got = learned_items(connection_id, limit=500)
    out = []
    for i in got["items"]:
        if i["kind"] not in ("finding", "usage") or i["standing"] not in ("measured", "mined", "said"):
            continue
        out.append(_row(source=i["kind"], ref=i["ref"], kind="candidate", title=i["text"],
                        detail=f"{i['standing_said'].capitalize()}, from {i['source']}; no answer leans on it until a "
                               "person confirms it.",
                        area=i.get("area") or "", at=i.get("as_of") or "", href=link["claim"](i["ref"]),
                        action="Confirm it, or mark it wrong",
                        actions=[_call("accept", "Confirm it", "POST", f"/record/claims/{quote(i['ref'], safe='')}/right", {}),
                                 _call("reject", "Mark it wrong", "POST", f"/record/claims/{quote(i['ref'], safe='')}/wrong",
                                       {"why": "marked wrong in review"})]))
    return out


def _definitions(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.record.writers import definitions
    out = []
    for c in definitions(connection_id):
        term = str(c.extra.get("term") or c.statement.text[:60])
        area = str(c.extra.get("area") or "")
        for s in c.extra.get("suggestions") or []:
            who = "the coworker, for " + str(s.get("by")) if s.get("by_agent") else str(s.get("by") or "someone")
            out.append(_row(source="definition_suggestion", ref=f"{c.id}:{s.get('id')}", kind="candidate",
                            title=f"A suggested edit to “{term}”",
                            detail=f"From {who}: {(s.get('text') or 'other names or links')[:240]}",
                            area=area, at=str(s.get("at") or ""), href=link["definition"](term, area),
                            action="Accept or decline it",
                            actions=[*(_call(do, label, "POST", "/record/definitions/suggestions/decide",
                                             {"connection_id": connection_id, "term": term, "area": area,
                                              "suggestion_id": str(s.get("id") or ""), "accept": do == "accept"})
                                       for do, label in (("accept", "Accept"), ("reject", "Decline"))),
                                     _definition_page("edit", "Edit and accept", connection_id, term, area)]))
        if c.tier == "said":
            by = "the coworker" if c.extra.get("drafted_by_agent") else (c.author or "someone")
            out.append(_row(source="definition_draft", ref=c.id, kind="candidate", title=f"“{term}”, a draft",
                            detail=f"Drafted by {by}: {c.statement.text[:240]}. Not used until its owner publishes it.",
                            area=area, at=c.as_of, href=link["definition"](term, area), action="Publish it, or change it",
                            actions=[_call("accept", "Publish it", "POST", "/record/definitions/approve",
                                           {"connection_id": connection_id, "term": term, "area": area}),
                                     _definition_page("edit", "Edit and publish", connection_id, term, area)]))
    return out


def _term_of(text: str) -> str:
    """The word a learned item is about, as Promote guesses it (`web/lib/learned.wordOf`): its words before a colon or a
    dash, when short — "" when it names none."""
    t = re.sub(r"^Restated:\s*", "", text or "", flags=re.IGNORECASE).strip()
    head = re.sub(r"\s*\(.*\)\s*$", "", re.split(r":\s|\s[—–-]\s", t)[0]).strip()
    return head if head and len(head) <= 60 and head != t else ""


def _new_definitions(connection_id: str, link: dict) -> list[dict]:
    """New Definition (the Atlas plan's §3.4, A5): what was learned again and again about a word no Definition holds —
    "learned 3 times; no Definition says what it means". Weighed by how often it was learned: the answers that drew on a
    learned item are not counted yet (A1 counts what an answer was given), and the row says what it is weighed by."""
    from pramanyx.knowledge.learned import learned_items
    from pramanyx.record.writers import definition_term, definitions
    defined = {definition_term(str(c.extra.get("term") or "")) for c in definitions(connection_id)}
    out = []
    for i in learned_items(connection_id, limit=500)["items"]:
        times = int(i.get("times") or 1)
        term = _term_of(i["text"]) if i["kind"] != "trusted_query" and times >= 2 else ""
        if not term or definition_term(term) in defined:
            continue
        out.append(_row(source="new_definition", ref=i["ref"] or _ref(i["text"]), kind="candidate",
                        title=f"“{term}” — learned {times} times; no Definition says what it means",
                        detail=i["text"][:240], area=i.get("area") or "", count=times, at=i.get("as_of") or "",
                        href=link["new_definition"](term, i.get("area") or ""), action="Write its Definition",
                        actions=[_new_definition("Write its Definition", connection_id, term, i.get("area") or "")]))
    return out


def _definition_edits(connection_id: str, link: dict) -> list[dict]:
    """Definition edit (§3.4, A5): what was learned since a published Definition was last written that names its word —
    things the Definition may not cover yet, one row per Definition, weighed by how many."""
    from pramanyx.knowledge.learned import learned_items
    from pramanyx.record.writers import definitions
    published = [c for c in definitions(connection_id) if c.tier != "said" and str(c.extra.get("term") or "").strip()]
    if not published:
        return []
    learned = [i for i in learned_items(connection_id, limit=500)["items"] if i["kind"] != "trusted_query"]
    out = []
    for c in published:
        term = str(c.extra.get("term")).strip()
        area = str(c.extra.get("area") or "")
        names = re.compile(rf"(?<![a-z0-9]){re.escape(term.lower())}(?![a-z0-9])")
        since = [i for i in learned if str(i.get("as_of") or "") > str(c.as_of or "") and names.search(i["text"].lower())]
        if not since:
            continue
        n = len(since)
        out.append(_row(source="definition_edit", ref=c.id, kind="candidate",
                        title=f"{n} thing{'s' if n != 1 else ''} learned about “{term}” since its Definition was written",
                        detail=since[0]["text"][:240], area=area, count=n, at=str(since[0].get("as_of") or ""),
                        href=link["definition"](term, area), action="Read them against its Definition",
                        actions=[_definition_page("edit", "Read them against its Definition", connection_id, term, area)]))
    return out


def _proposed_synonyms(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.ontology.vocabulary import synonyms_for
    return [_row(source="synonym", ref=f"{s.subject_kind}:{s.subject_id}:{s.synonym}", kind="candidate",
                 title=f"“{s.synonym}” for {s.subject_id}", detail="Proposed by a model; it matches nothing until a "
                 "person keeps it.", href=link["definitions_tab"](), action="Keep it, or drop it",
                 actions=[_page("Keep it, or drop it", link["definitions_tab"]())])
            for s in synonyms_for(connection_id) if str(getattr(s, "source", "")) == "llm_candidate"]


def _suggested_areas(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.semantic.areas import suggested_areas
    out = []
    for s in suggested_areas(connection_id)[:PER_SOURCE]:
        shown = ", ".join(s["tables"][:4]) + (f" and {len(s['tables']) - 4} more" if len(s["tables"]) > 4 else "")
        out.append(_row(source="suggested_area", ref=s["id"], kind="candidate", title=f"“{s['label']}” as an area",
                        detail=f"The model labelled {len(s['tables'])} table{'s' if len(s['tables']) != 1 else ''} so"
                               f"{f' ({shown})' if shown else ''}. Not an area until a curator declares it.",
                        count=len(s["tables"]) or None, href=link["areas"](), action="Declare it, or say it is not one",
                        actions=[_page("Declare it", link["areas"]()),
                                 _call("reject", "Not an area", "PUT", f"/areas/{quote(connection_id, safe='')}/not-an-area",
                                       {"label": s["label"]})]))
    return out


def _imports(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.intake import store
    from pramanyx.org.context import current_org_id
    org = current_org_id() or "default"
    out = []
    for b in store.list_bundles(org_id=org, connection_id=connection_id):
        pending = [c for c in store.list_candidates(b["id"], org_id=org) if c.get("status") == "pending"]
        if pending:
            kinds = Counter(c["kind"] for c in pending)
            out.append(_row(source="import", ref=b["id"], kind="candidate",
                            title=f"{len(pending)} from {b.get('source') or 'an import'} wait for a verdict",
                            detail=", ".join(f"{n} {k.replace('_', ' ')}{'' if n == 1 else 's'}" for k, n in kinds.most_common()),
                            count=len(pending), at=str(b.get("uploaded_at") or ""), href=link["import_tab"](),
                            action="Accept or dismiss each", actions=[_page("Accept or dismiss each", link["import_tab"]())]))
    return out


def _marked_wrong(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.feedback.verdicts import list_corrections
    return [_row(source="verdict", ref=str(v.get("id")), kind="candidate",
                 title=f"Marked {'wrong' if v.get('verdict') == 'reject' else 'right, with a correction'}: "
                       f"{v.get('headline') or v.get('investigation_id')}",
                 detail=(str(v.get("note") or "").strip() or "No note.")[:240]
                        + (" A corrected SQL was given." if v.get("corrected_sql") else ""),
                 complaints=1, at=str(v.get("created_at") or ""), href=link["definitions_tab"](),
                 action="Write what it should have known", actions=[_new_definition("Write what it should have known", connection_id)])
            for v in list_corrections(connection_id, limit=PER_SOURCE)]


def _unhelpful(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.kernel.ledger import Ledger
    out = []
    for e in Ledger.default().events(kind="chat.feedback", conn_id=connection_id, limit=500):
        p = e.get("payload") if isinstance(e.get("payload"), dict) else {}
        if p.get("verdict") != "unhelpful":
            continue
        out.append(_row(source="unhelpful", ref=str(p.get("turn_id") or e.get("at")), kind="candidate",
                        title="An answer marked unhelpful", detail=(str(p.get("note") or "").strip() or "No note.")[:240],
                        complaints=1, at=str(e.get("at") or ""), href=link["definitions_tab"](),
                        action="Write what it should have known",
                        actions=[_new_definition("Write what it should have known", connection_id)]))
    return out[:PER_SOURCE]


def _rivals(connection_id: str, link: dict) -> list[dict]:
    from pramanyx.semantic.areas import rival_groups
    out = []
    for g in rival_groups(connection_id):
        names = [m["area_name"] for m in g["meanings"]]
        out.append(_row(source="rival_meanings", ref=g["term"], kind="conflict",
                        title=f"“{g['term']}” means different things in {', '.join(names[:-1])} and {names[-1]}",
                        detail=" · ".join(f"{m['area_name']}: {m['text'][:120]}" for m in g["meanings"]),
                        area=",".join(m["area"] for m in g["meanings"]), href=link["definition"](g["term"]),
                        action="Read both meanings; a question that names neither is asked which",
                        actions=[_definition_page("edit", "Read both meanings", connection_id, g["term"])]))
    return out


def _answered_two_ways(connection_id: str, link: dict) -> list[dict]:
    """A question answered more than one way. A scheduled question is left out: its answer moves with the period it
    asks about by design, so a schedule over "last week" is answered differently every week (theLook's live list,
    2026-11-17, showed three such schedules as conflicts, under their code-written preamble)."""
    from pramanyx.automations.temporal import ask_of
    from pramanyx.semantic.answer_divergence import detect
    return [_row(source="divergence", ref=d.question_key, kind="conflict",
                 title=f"Answered {d.variant_count} ways: {d.question}",
                 detail=f"Asked {d.run_count} times; the most-used answer was reused {d.top_reuse} times.",
                 count=d.run_count, href=None, action="Settle it")
            for d in detect(connection_id)[:PER_SOURCE] if not d.pinned and ask_of(d.question) == d.question]


def _eval_failures(connection_id: str, link: dict) -> list[dict]:
    """What the context-layer evals found the layer did not reach (§7.9, decision 3): a published Definition not given to
    the answer about it, a metric's formula not used, a trusted query not given, a corrected answer still answered as it
    was. From the newest run; a connection never evaluated has none."""
    from pramanyx.evals.context_layer import SOURCE_WORDS, failures
    out = []
    for f in failures(connection_id)[:PER_SOURCE]:
        name, source = f["name"] or f["question"], f["source"]
        actions: list[dict] = []
        if source == "definition":
            _, term, area = (f["ref"].split("/", 2) + ["", ""])[:3]
            actions.append(_definition_page("edit", "Read its Definition", connection_id, term, area))
        out.append(_row(source="eval_failed", ref=f["id"], kind="gap",
                        title=f"“{name}” did not reach the answer to “{f['question']}”",
                        detail=f"{SOURCE_WORDS.get(source, source)}: {f['result']['why']}.",
                        href=link["definitions_tab"](), action="Write what the answer needed to be given", actions=actions))
    return out


SOURCES: tuple[tuple[str, Callable[[str, dict], list[dict]]], ...] = (
    ("framing_miss", _framing_misses), ("unanswered", _unanswered),
    ("unconfirmed", _unconfirmed), ("definitions", _definitions), ("synonym", _proposed_synonyms),
    ("suggested_area", _suggested_areas), ("new_definition", _new_definitions), ("definition_edit", _definition_edits),
    ("import", _imports), ("verdict", _marked_wrong), ("unhelpful", _unhelpful),
    ("rival_meanings", _rivals), ("divergence", _answered_two_ways), ("eval_failed", _eval_failures),
)


# ── the view ─────────────────────────────────────────────────────────────────────────────────────────────────────


def review(connection_id: str, *, area: str = "", limit: int = 200) -> dict:
    """``{items, sources, unread, areas, total}`` — what waits on a person for this connection's knowledge, busiest
    first, each row with the page it is decided on and the owners of its area; ``area`` narrows to one area (a conflict
    spanning it included)."""
    from pramanyx.kernel.errors import tolerate
    link = _links(connection_id)
    items: list[dict] = []
    sources: dict[str, int] = {}
    unread: list[str] = []
    from pramanyx.knowledge.learned import read_once
    with read_once():          # three sources read the learned list: read once, for all of them
        for name, read in SOURCES:
            try:
                got = read(connection_id, link)
            except Exception as exc:  # noqa: BLE001 — unread is said, never taken for none
                tolerate(exc, f"the review queue could not read {name}", counter="review.unread")
                unread.append(name)
                continue
            sources[name] = len(got)
            items.extend(got)

    try:
        from pramanyx.semantic.areas import areas_for
        declared = {a["id"]: a for a in areas_for(connection_id)}
    except Exception as exc:  # noqa: BLE001
        tolerate(exc, "the review queue could not read the areas", counter="review.areas")
        declared, unread = {}, [*unread, "areas"]
    for i in items:
        owners: list[str] = []
        for a in [x for x in i["area"].split(",") if x]:
            d = declared.get(a) or {}
            owners += [*d.get("business_owners", []), *d.get("technical_owners", [])]
        i["owners"] = sorted(set(owners))

    if area:
        items = [i for i in items if area in i["area"].split(",")]
    items.sort(key=lambda i: (-((i["count"] or 1) + 2 * i["complaints"]), _newest(i["at"]), i["id"]))
    per_area: Counter = Counter(a for i in items for a in i["area"].split(",") if a)
    coverage = [{"id": a_id, "name": d.get("name") or a_id,
                 "owners": sorted({*d.get("business_owners", []), *d.get("technical_owners", [])}),
                 "waiting": per_area.get(a_id, 0)}
                for a_id, d in declared.items()]
    coverage.sort(key=lambda a: (-a["waiting"], a["name"]))
    return {"connection_id": connection_id, "items": items[:limit], "total": len(items),
            "by_kind": {k: sum(1 for i in items if i["kind"] == k) for k in KINDS},
            "unplaced": sum(1 for i in items if not i["area"]),
            "sources": sources, "unread": unread, "areas": coverage}


def _newest(at: str) -> str:
    """Sorts the newest first among equals: the complement of each digit."""
    return "".join(chr(ord("9") - ord(ch) + ord("0")) if ch.isdigit() else ch for ch in (at or "")[:19]) or "~"


__all__ = ["review", "SOURCES", "KINDS"]

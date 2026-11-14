"""Slack, as knowledge: what was said in the channels a bot is in, readable by that channel's members only.

The Genie One study's sources step, Slack first (the user, 2026-11-15). Genie One reads a company's Slack; here it is
read through the Slack bot an organisation already connected (`pramanyx/slackbots`), and only where that bot was
invited — a channel nobody added it to is never read.

* **One document per channel per day.** A day's messages, in order, each with who said it — the unit a reader
  cites ("#ops on 3 November"), small enough to index, large enough to carry a conversation. Thread replies are not
  read in this first slice; the channel's own line is.
* **Who may read it is the channel's members, as Slack says now** (`knowledge/access.py`): their emails, read from
  Slack's own profiles. A member whose email Slack does not give is not a reader — narrower, never wider. A channel
  whose members cannot be read at all is readable by no one but a single-user install, and says why.
* **A sync re-states who may read every day it writes**, so someone who left a channel stops reading what is synced
  after; a day already synced is re-read for the last ``REREAD_DAYS`` only.
* **What Slack refuses is said**, with the permission it named (``missing_scope``, ``needed: channels:read``), on the
  source's status — never an empty index that reads as a quiet workspace.

Scopes this needs beyond the bot's own (`slackbots/manifest.py` lists them, so a new bot is installed with them):
``channels:read`` and ``groups:read`` (which channels, and who is in them) and ``users:read.email`` (members'
emails); ``channels:history`` / ``groups:history`` it already has.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

import requests

logger = logging.getLogger(__name__)

_API = "https://slack.com/api/"
#: How far back a first sync reads, in days, unless the source says otherwise (``days``).
DEFAULT_DAYS = 30
#: Days re-read on every later sync, so an edit, a late reply or a membership change reaches the index.
REREAD_DAYS = 2
_PAGE = 200
_SKIP_SUBTYPES = frozenset({"channel_join", "channel_leave", "bot_message", "channel_topic", "channel_purpose",
                            "channel_name", "pinned_item", "tombstone"})


class SlackRefused(RuntimeError):
    """Slack said no — with its own error and, for a missing permission, the scope it needs."""

    def __init__(self, method: str, error: str, needed: str = ""):
        super().__init__(f"Slack refused {method}: {error}" + (f" (needs the {needed} permission)" if needed else ""))
        self.method, self.error, self.needed = method, error, needed


class SlackSync:
    """Reads the channels a bot is in into the document index, each day readable by the channel's members."""

    def __init__(self, bot_id: str, token: str, meta: Optional[dict] = None, *, session=None) -> None:
        if not token:
            raise ValueError("a Slack sync needs the bot's token")
        self._bot_id = bot_id
        self._meta = dict(meta or {})
        self._days = max(1, min(int(self._meta.get("days") or DEFAULT_DAYS), 365))
        self._session = session or requests.Session()
        self._session.headers.update({"Authorization": f"Bearer {token}"})
        self._people: dict[str, dict] = {}
        from pramanyx.db.paths import state_dir
        self._state_path = state_dir() / f"knowledge_sync_slack_{bot_id}.json"

    # ── Slack ─────────────────────────────────────────────────────────────────────────────────────────────

    def _call(self, method: str, **params) -> dict:
        for attempt in range(3):
            r = self._session.get(_API + method, params=params, timeout=20)
            if r.status_code == 429 and attempt < 2:                              # rate limited: wait as told
                time.sleep(min(30, int(r.headers.get("Retry-After") or 1)))
                continue
            r.raise_for_status()
            body = r.json()
            if not body.get("ok"):
                raise SlackRefused(method, str(body.get("error") or "unknown"), str(body.get("needed") or ""))
            return body
        raise SlackRefused(method, "rate_limited")

    def _paged(self, method: str, key: str, **params) -> Iterator[dict]:
        cursor = ""
        while True:
            body = self._call(method, limit=_PAGE, **params, **({"cursor": cursor} if cursor else {}))
            yield from body.get(key) or []
            cursor = ((body.get("response_metadata") or {}).get("next_cursor") or "").strip()
            if not cursor:
                return

    def channels(self) -> list[dict]:
        """The channels the bot is a member of — the only ones read."""
        return [c for c in self._paged("conversations.list", "channels", types="public_channel,private_channel",
                                       exclude_archived="true") if c.get("is_member")]

    def _person(self, user_id: str) -> dict:
        if user_id not in self._people:
            try:
                u = self._call("users.info", user=user_id).get("user") or {}
            except SlackRefused as exc:
                if exc.needed:
                    raise
                u = {}
            prof = u.get("profile") or {}
            self._people[user_id] = {"name": prof.get("display_name") or prof.get("real_name") or u.get("name") or user_id,
                                     "email": str(prof.get("email") or "").strip().lower(),
                                     "bot": bool(u.get("is_bot") or u.get("deleted"))}
        return self._people[user_id]

    def readers(self, channel_id: str) -> tuple[list[str], int]:
        """The members' emails, and how many members could not be matched to one (bots aside)."""
        emails, unmatched = [], 0
        for uid in self._paged("conversations.members", "members", channel=channel_id):
            p = self._person(str(uid))
            if p["bot"]:
                continue
            if p["email"]:
                emails.append(p["email"])
            else:
                unmatched += 1
        return emails, unmatched

    def messages(self, channel_id: str, oldest: float) -> list[dict]:
        out = [m for m in self._paged("conversations.history", "messages", channel=channel_id, oldest=f"{oldest:.6f}")
               if (m.get("text") or "").strip() and m.get("subtype") not in _SKIP_SUBTYPES]
        return sorted(out, key=lambda m: float(m.get("ts") or 0))

    # ── indexing ──────────────────────────────────────────────────────────────────────────────────────────

    def _access(self, name: str, emails: list[str], unmatched: int) -> dict:
        from pramanyx.connectors.knowledge import chosen
        why = f"Slack: the members of #{name}"
        if unmatched:
            why += f"; {unmatched} member{'s' if unmatched != 1 else ''} without an email in Slack cannot read it here"
        if not emails:
            why = f"Slack: no member of #{name} could be matched to a person here"
        return chosen(emails, [], why, "slack-channel-members")

    def _day_text(self, msgs: list[dict]) -> str:
        lines = []
        for m in msgs:
            at = datetime.fromtimestamp(float(m.get("ts") or 0), tz=timezone.utc).strftime("%H:%M")
            who = self._person(str(m.get("user"))).get("name") if m.get("user") else (m.get("username") or "someone")
            lines.append(f"{at} {who}: {str(m.get('text') or '').strip()}")
        return "\n".join(lines)

    def sync(self) -> dict:
        from pramanyx.connectors.knowledge import MAX_SKIPPED_LISTED, index_page, skipped_entry
        state = self._load_state()
        now = datetime.now(timezone.utc)
        first = now - timedelta(days=self._days)
        days_indexed, skipped, skipped_count, channels_read = 0, [], 0, []
        try:
            channels = self.channels()
        except SlackRefused as exc:
            return self._refused(state, exc)
        for ch in channels:
            cid, name = str(ch.get("id")), str(ch.get("name") or ch.get("id"))
            last = (state.get("channels") or {}).get(cid, {}).get("synced_through")
            since = max(first, datetime.fromisoformat(last) - timedelta(days=REREAD_DAYS)) if last else first
            try:
                emails, unmatched = self.readers(cid)
                msgs = self.messages(cid, since.timestamp())
            except SlackRefused as exc:
                if exc.needed:
                    return self._refused(state, exc)
                skipped_count += 1
                if len(skipped) < MAX_SKIPPED_LISTED:
                    skipped.append(skipped_entry(f"#{name}", "", str(exc)))
                continue
            access = self._access(name, emails, unmatched)
            by_day: dict[str, list[dict]] = {}
            for m in msgs:
                day = datetime.fromtimestamp(float(m.get("ts") or 0), tz=timezone.utc).strftime("%Y-%m-%d")
                by_day.setdefault(day, []).append(m)
            for day, day_msgs in sorted(by_day.items()):
                why = index_page(text=self._day_text(day_msgs), title=f"#{name} · {day}", source=f"slack:#{name}",
                                 doc_id=f"slack_{self._bot_id}_{cid}_{day.replace('-', '')}",
                                 source_url=f"https://slack.com/app_redirect?channel={cid}", access=access)
                if why is None:
                    days_indexed += 1
                else:
                    skipped_count += 1
                    if len(skipped) < MAX_SKIPPED_LISTED:
                        skipped.append(skipped_entry(f"#{name} · {day}", "", why))
            state.setdefault("channels", {})[cid] = {"name": name, "synced_through": now.isoformat(),
                                                     "readers": len(emails), "unmatched": unmatched}
            channels_read.append(name)
        state.update({"last_sync": now.isoformat().replace("+00:00", "Z"), "pages_indexed": days_indexed,
                      "channels_read": channels_read, "pages_skipped": skipped, "skipped_count": skipped_count,
                      "refused": ""})
        self._save_state(state)
        logger.info("Slack sync for %s: %d channel-days indexed from %d channels", self._bot_id, days_indexed,
                    len(channels_read))
        return {"pages_indexed": days_indexed, "channels": channels_read, "skipped_count": skipped_count}

    def _refused(self, state: dict, exc: SlackRefused) -> dict:
        state.update({"last_sync": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "refused": str(exc)})
        self._save_state(state)
        return {"pages_indexed": 0, "refused": str(exc), "needed": exc.needed}

    # ── state ─────────────────────────────────────────────────────────────────────────────────────────────

    def _load_state(self) -> dict:
        try:
            return json.loads(self._state_path.read_text()) if self._state_path.exists() else {}
        except (OSError, ValueError):
            return {}

    def _save_state(self, state: dict) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state_path.write_text(json.dumps(state, indent=2))

    def status(self) -> dict:
        s = self._load_state()
        return {"bot_id": self._bot_id, "last_sync": s.get("last_sync"), "pages_indexed": s.get("pages_indexed", 0),
                "channels": [{"name": c.get("name"), "readers": c.get("readers", 0), "unmatched": c.get("unmatched", 0)}
                             for c in (s.get("channels") or {}).values()],
                "pages_skipped": s.get("pages_skipped", []), "skipped_count": s.get("skipped_count", 0),
                "refused": s.get("refused", "")}

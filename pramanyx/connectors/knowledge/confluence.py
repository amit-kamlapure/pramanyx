"""Confluence knowledge connector — indexes Confluence pages into pramanyx_documents.

Unlike database connectors, this does NOT implement execute()/get_schema().
It fetches Confluence wiki pages and indexes them into the existing Qdrant
document collection so they appear in investigation synthesis context.

DSN:   confluence://  (sentinel)
Meta:  {
  "base_url":    "https://yourorg.atlassian.net",
  "username":    "user@example.com",
  "api_token":   "ATATT3…",          (Atlassian API token)
  "space_keys":  "ENG,PROD,DATA",    (comma-sep, or empty = all spaces)
  "page_limit":  "500"               (optional, max pages to sync)
}

Auth: HTTP Basic — username + API token.
URL:  https://yourorg.atlassian.net/wiki/rest/api/content

Optional dep: none — uses requests (always available).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional, Iterator

import requests

logger = logging.getLogger(__name__)

_PAGE_SIZE  = 50       # Confluence max per request is 100; 50 is safe


def _html_to_text(html: str) -> str:
    """Strip Confluence storage-format XML/HTML to plain text."""
    # Remove script/style blocks
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.I)
    # Replace block-level tags with newlines
    html = re.sub(r"<(p|br|li|h[1-6]|div|tr)[^>]*>", "\n", html, flags=re.I)
    # Strip remaining tags
    html = re.sub(r"<[^>]+>", " ", html)
    # Decode common HTML entities
    html = html.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">") \
               .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    # Collapse whitespace
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", html)).strip()


class ConfluenceSync:
    """Fetches Confluence pages and indexes them into pramanyx_documents."""

    def __init__(self, connection_id: str, meta: dict) -> None:
        self._conn_id   = connection_id
        self._meta      = dict(meta or {})
        self._base_url  = meta.get("base_url", "").rstrip("/")
        self._username  = meta.get("username", "")
        self._api_token = meta.get("api_token", "")
        self._space_keys = [s.strip() for s in meta.get("space_keys", "").split(",") if s.strip()]
        self._page_limit = int(meta.get("page_limit", 500))
        # Resolved on CALL, never at import (the vocabulary._ROOT freeze, 3×): a bare
        # Path("data") was also CWD-relative, so any process not started at the repo
        # root read an empty sync state and re-synced from scratch.
        from pramanyx.db.paths import state_dir
        self._state_path = state_dir() / f"knowledge_sync_{connection_id}.json"

        if not (self._base_url and self._username and self._api_token):
            raise ValueError("Confluence connector requires base_url, username, and api_token")

        self._session = requests.Session()
        self._session.auth = (self._username, self._api_token)
        self._session.headers.update({"Accept": "application/json"})

    # ── State ──────────────────────────────────────────────────────────────────

    def _load_state(self) -> dict:
        try:
            if self._state_path.exists():
                return json.loads(self._state_path.read_text())
        except Exception:
            pass
        return {}

    def _save_state(self, state: dict) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state_path.write_text(json.dumps(state, indent=2))

    # ── Confluence REST API ────────────────────────────────────────────────────

    def _list_spaces(self) -> list[str]:
        if self._space_keys:
            return self._space_keys
        resp = self._session.get(
            f"{self._base_url}/wiki/rest/api/space",
            params={"limit": 50, "type": "global"},
            timeout=15,
        )
        resp.raise_for_status()
        return [s["key"] for s in resp.json().get("results", [])]

    def _iter_pages(self, space_key: str) -> Iterator[dict]:
        """Yield page dicts with {id, title, body.storage.value} from a space."""
        start = 0
        fetched = 0
        while True:
            resp = self._session.get(
                f"{self._base_url}/wiki/rest/api/content",
                params={
                    "type":   "page",
                    "spaceKey": space_key,
                    # Who may read the page, and the pages above it: a read restriction on an ancestor holds for
                    # every page under it (`_access_of`).
                    "expand": "body.storage,ancestors,restrictions.read.restrictions.user,"
                              "restrictions.read.restrictions.group",
                    "limit":  _PAGE_SIZE,
                    "start":  start,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            if not results:
                break
            for page in results:
                yield page
                fetched += 1
                if fetched >= self._page_limit:
                    return
            if not data.get("_links", {}).get("next"):
                break
            start += _PAGE_SIZE

    # ── Who may read a page ────────────────────────────────────────────────────

    def _read_restriction(self, content: dict) -> Optional[tuple[set[str], set[str], int]]:
        """A page's own READ restriction as (people by email, groups by name, readers with no email), or None when
        it has none. A reader Confluence names without an email cannot be matched to a person here: counted, and
        not a reader."""
        read = ((content.get("restrictions") or {}).get("read") or {}).get("restrictions") or {}
        users = (read.get("user") or {}).get("results") or []
        groups = (read.get("group") or {}).get("results") or []
        if not users and not groups:
            return None
        emails = {str(u.get("email") or "").strip().lower() for u in users if str(u.get("email") or "").strip()}
        names = {str(g.get("name") or "").strip() for g in groups if str(g.get("name") or "").strip()}
        return emails, names, sum(1 for u in users if not str(u.get("email") or "").strip())

    def _ancestor_restriction(self, ancestor_id: str):
        """An ancestor's read restriction, read once per sync."""
        cache = self.__dict__.setdefault("_ancestors_read", {})
        if ancestor_id not in cache:
            try:
                resp = self._session.get(
                    f"{self._base_url}/wiki/rest/api/content/{ancestor_id}",
                    params={"expand": "restrictions.read.restrictions.user,restrictions.read.restrictions.group"},
                    timeout=15)
                resp.raise_for_status()
                cache[ancestor_id] = ("ok", self._read_restriction(resp.json()))
            except Exception as exc:  # noqa: BLE001 — an ancestor that cannot be read restricts to no one
                cache[ancestor_id] = ("unread", str(exc)[:120])
        return cache[ancestor_id]

    def _access_of(self, page: dict) -> dict:
        """Who may read this page, as Confluence says (`knowledge/access.py`).

        A read restriction holds for the page and every page under it, so each restricted level — the page and
        each ancestor — must admit a reader. Group membership is not expanded here, so where several levels are
        restricted the readers are the people and the groups named at EVERY level: narrower than Confluence may be,
        never wider. A page no level restricts is read by whom the source's audience names (the space's own
        permissions are not read: the person who connected the source says who reads its unrestricted pages). An
        ancestor that cannot be read, or a restriction none of whose readers can be matched, leaves the page to the
        person who connected the source alone."""
        from pramanyx.knowledge.access import chosen, source_audience
        owner = str(self._meta.get("connected_by") or "").strip()
        levels = []
        own = self._read_restriction(page)
        if own is not None:
            levels.append(own)
        for anc in page.get("ancestors") or []:
            state, got = self._ancestor_restriction(str(anc.get("id") or ""))
            if state != "ok":
                return chosen([owner] if owner else [], [], f"a page above it could not be read ({got}), so only the "
                              "person who connected the source reads it", "confluence-restrictions")
            if got is not None:
                levels.append(got)
        if not levels:
            return source_audience(self._meta, what="Confluence places no read restriction on the page")
        people = set.intersection(*(lv[0] for lv in levels))
        groups = set.intersection(*(lv[1] for lv in levels))
        unmatched = sum(lv[2] for lv in levels)
        if not people and not groups:
            return chosen([owner] if owner else [], [], "Confluence restricts the page and none of its readers could "
                          "be matched here, so only the person who connected the source reads it",
                          "confluence-restrictions")
        note = f"; {unmatched} of its readers have no email Confluence shares and are not matched" if unmatched else ""
        return chosen(sorted(people), sorted(groups), f"Confluence restricts who may read the page{note}",
                      "confluence-restrictions")

    # ── Main sync ──────────────────────────────────────────────────────────────

    def sync(self) -> dict[str, int]:
        """Sync all pages. Returns {space_key: pages_indexed}; the pages that did not land
        are kept on the state with their reason (``pages_skipped``)."""
        from pramanyx.connectors.knowledge import MAX_SKIPPED_LISTED, index_page, skipped_entry
        state = self._load_state()
        results: dict[str, int] = {}
        skipped: list[dict] = []
        skipped_count = 0

        spaces = self._list_spaces()
        logger.info("Confluence sync: %d spaces for %s", len(spaces), self._conn_id)

        for space_key in spaces:
            count = 0
            for page in self._iter_pages(space_key):
                page_id = page.get("id", "")
                title   = page.get("title", "Untitled")
                html    = page.get("body", {}).get("storage", {}).get("value", "")
                text    = _html_to_text(html)
                source_url = f"{self._base_url}/wiki/spaces/{space_key}/pages/{page_id}"
                why = index_page(
                    text=text,
                    title=f"[{space_key}] {title}",
                    source=f"confluence:{space_key}",
                    doc_id=f"confluence_{self._conn_id}_{page_id}",
                    source_url=source_url,
                    access=self._access_of(page),
                )
                if why is None:
                    count += 1
                    continue
                skipped_count += 1
                if len(skipped) < MAX_SKIPPED_LISTED:
                    skipped.append(skipped_entry(f"[{space_key}] {title}", source_url, why))
            results[space_key] = count
            logger.info("Confluence: indexed %d pages from space %s", count, space_key)

        state["last_sync"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z")
        state["pages_indexed"] = {k: results.get(k, 0) for k in spaces}
        state["pages_skipped"] = skipped
        state["skipped_count"] = skipped_count
        self._save_state(state)
        return results

    def test(self) -> tuple[bool, str]:
        try:
            resp = self._session.get(
                f"{self._base_url}/wiki/rest/api/space",
                params={"limit": 1},
                timeout=10,
            )
            resp.raise_for_status()
            total = resp.json().get("size", "?")
            return True, f"Confluence connected — {total} accessible spaces"
        except Exception as e:
            return False, str(e)

    def status(self) -> dict:
        state = self._load_state()
        return {
            "connection_id": self._conn_id,
            "last_sync":     state.get("last_sync"),
            "pages_indexed": state.get("pages_indexed", {}),
            "pages_skipped": state.get("pages_skipped", []),
            "skipped_count": state.get("skipped_count", 0),
            "space_keys":    self._space_keys,
        }

"""The web, for outside context only (the Genie One study; the user's call of 2026-11-15).

The coworker's shell ships a web search of its own; it was switched off on 2026-11-13 because the agent's reach must
not go around the platform. This is the platform's own: a person can ask what else was going on — a public holiday,
the news, a competitor's announcement — and the answer says where it read it.

* **An organisation's setting, off by default** (`web_search`): the words searched leave the install for the search
  provider. Off, the search is refused with where to turn it on.
* **A provider the operator configures**, with its own key, in the API's environment: ``PRAMANYX_WEB_SEARCH_PROVIDER``
  (``brave`` or ``tavily``) and ``PRAMANYX_WEB_SEARCH_KEY``. None configured, the search says so. No key is ever
  typed into a page or a conversation.
* **Every search is an outside call** (`govern/outbound.external_call`): checked against the usage caps before it is
  made, a span in the run's trace, and an event that counts it — and journaled ``web.searched`` with the words
  searched and who searched them, because those words left.
* **What comes back is a source, never a figure.** A result is a title, an address and the page's own snippet; it is
  shown cited, and the coworker is told never to state a figure about the business from it.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass

import httpx

SETTING = "web_search"
MAX_RESULTS = 8
_TIMEOUT = 12.0


class SearchRefused(RuntimeError):
    """The search was not made, and why — the setting is off, or no provider is configured."""


@dataclass
class Result:
    title: str
    url: str
    snippet: str
    published: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


def provider() -> tuple[str, str]:
    """The configured provider and its key, or ("", "")."""
    name = os.environ.get("PRAMANYX_WEB_SEARCH_PROVIDER", "").strip().lower()
    key = os.environ.get("PRAMANYX_WEB_SEARCH_KEY", "").strip()
    return (name, key) if name in ("brave", "tavily") and key else ("", "")


def _brave(query: str, n: int, key: str) -> list[Result]:
    r = httpx.get("https://api.search.brave.com/res/v1/web/search", params={"q": query, "count": n},
                  headers={"accept": "application/json", "X-Subscription-Token": key}, timeout=_TIMEOUT)
    r.raise_for_status()
    hits = ((r.json() or {}).get("web") or {}).get("results") or []
    return [Result(title=str(h.get("title") or ""), url=str(h.get("url") or ""),
                   snippet=str(h.get("description") or ""), published=str(h.get("age") or "")) for h in hits[:n]]


def _tavily(query: str, n: int, key: str) -> list[Result]:
    r = httpx.post("https://api.tavily.com/search", json={"api_key": key, "query": query, "max_results": n},
                   timeout=_TIMEOUT)
    r.raise_for_status()
    hits = (r.json() or {}).get("results") or []
    return [Result(title=str(h.get("title") or ""), url=str(h.get("url") or ""),
                   snippet=str(h.get("content") or ""), published=str(h.get("published_date") or "")) for h in hits[:n]]


_PROVIDERS = {"brave": _brave, "tavily": _tavily}


def search(query: str, n: int = 5, *, by: str = "") -> list[Result]:
    """Search the web. Raises :class:`SearchRefused` when it may not or cannot, with the sentence to show."""
    from pramanyx.orgsettings.allows import WHERE, allows
    q = " ".join(str(query or "").split())[:300]
    if not q:
        raise SearchRefused("There is nothing to search for.")
    if not allows(SETTING):
        raise SearchRefused(f"Searching the web is off for this organisation. An admin can turn it on in {WHERE}.")
    name, key = provider()
    if not name:
        raise SearchRefused("No web search provider is configured on this install. The operator sets "
                            "PRAMANYX_WEB_SEARCH_PROVIDER (brave or tavily) and PRAMANYX_WEB_SEARCH_KEY.")
    n = max(1, min(int(n or 5), MAX_RESULTS))
    from pramanyx.govern.outbound import OutboundBlocked, external_call
    try:
        with external_call("web_search", name, attributes={"results": n}) as extra:
            found = _PROVIDERS[name](q, n, key)
            extra["results"] = len(found)
    except OutboundBlocked as exc:
        raise SearchRefused(f"A usage cap stopped the search: {exc.reason}") from exc
    except httpx.HTTPError as exc:
        raise SearchRefused(f"The search provider did not answer ({type(exc).__name__}).") from exc
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit("web.searched", {"query": q, "provider": name, "results": len(found), "by": by})
    except Exception as exc:  # noqa: BLE001 — the search was made; its journal line is the record of it
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a web search was made; its journal line was not written", counter="web_search.journal")
    return [r for r in found if r.url.startswith(("https://", "http://"))]

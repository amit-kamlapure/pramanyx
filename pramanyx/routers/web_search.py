"""`GET /web/search` — the web, for outside context only (`pramanyx/web_search.py`). Behind the organisation's
`web_search` setting, off by default; a refusal is answered with its sentence, so whoever asked can say it."""
from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["web"])


@router.get("/web/search")
def search_the_web(q: str, request: Request, n: int = 5):
    """Search the web: titles, addresses and the pages' own snippets — sources to cite, never figures."""
    from pramanyx import web_search
    from pramanyx.security.authz import acting_person, get_principal
    try:
        found = web_search.search(q, n, by=acting_person(get_principal(request)))
    except web_search.SearchRefused as exc:
        return {"results": [], "refused": str(exc)}
    return {"results": [r.as_dict() for r in found],
            "use": "Outside context only. Cite each source by its address; never state a figure about the business "
                   "from these."}

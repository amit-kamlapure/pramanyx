"""The map under a map answer (the coworker as a two-way door, maps, 2026-11-17).

A map answer's points and filled shapes are drawn in the browser from the answer's own rows and the shapes the
install ships; none of it leaves. A base map under them — streets, coastlines, place names — is fetched from a tile
server square by square, so which squares a person views go to that server. An organisation chooses:

- none (the default): the shapes are drawn on a blank ground, with the world's outline for bearing;
- OpenFreeMap's public tiles: free, MIT-licensed, no key, no cookies, and its access logs keep no IP addresses; the
  data is © OpenStreetMap contributors and the attribution is shown under the map;
- the organisation's own tile server (OpenFreeMap's planet self-hosts in about 170 GB), by its style URL.

Geocoding — an address to a point — is not offered: OpenFreeMap has none, and an outside geocoder would send the
addresses themselves.
"""
from __future__ import annotations

#: Where an admin chooses it: its own card beside what Pramanyx may do.
WHERE = "Settings ▸ Organization ▸ Base map"

#: OpenFreeMap's styles: a quiet light one and its dark one, so the map wears the page's theme.
OPENFREEMAP = {
    "light": "https://tiles.openfreemap.org/styles/positron",
    "dark": "https://tiles.openfreemap.org/styles/dark",
}


def base_map() -> dict:
    """What the browser draws under a map answer, and the sentence that says it. No secret is in it: a style URL is
    what every viewer's browser fetches."""
    from pramanyx.orgsettings.store import load_org_settings
    s = load_org_settings()
    if s.base_map == "openfreemap":
        return {"kind": "openfreemap", **OPENFREEMAP,
                "says": "Base map: OpenFreeMap's public tiles, © OpenStreetMap contributors. Only which map squares "
                        "are viewed leave this install; the answer's rows are drawn here and never leave."}
    if s.base_map == "own" and s.base_map_url:
        return {"kind": "own", "light": s.base_map_url, "dark": s.base_map_url,
                "says": "Base map: your organisation's own tile server."}
    says = "No base map: the shapes are drawn on a blank ground."
    if s.base_map == "own":
        says = "No base map: your own tile server is chosen, but no style URL is set."
    return {"kind": "none", "light": "", "dark": "", "says": f"{says} An admin can choose one in {WHERE}."}

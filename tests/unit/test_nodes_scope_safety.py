"""Scope-safety regression guard for agent.nodes.

`classify_question` once called `re.search` while `re` was only imported *locally*
inside other functions → `NameError: name 're' is not defined`. It compiles cleanly and
passes imports; only a runtime hit on the definitional branch exposes it."""
from pramanyx.agent import nodes as N


def test_re_imported_at_module_scope():
    import re as _re
    assert getattr(N, "re", None) is _re, "agent.nodes must import `re` at module scope"

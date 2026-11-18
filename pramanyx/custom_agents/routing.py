"""Which of a connection's agents a question goes to (punch list 93, 2026-11-18).

A question should go to the agent whose scope fits it before anything else; the coworker had each custom agent
as a tool (`ask_<slug>`) and left the choice to the model, which rarely made it. A connection's agents are known before
the first question, so the coworker is told them where it reads its instructions for that connection (`AGENTS.md`,
written by its home plugin from what this module says): the connection's own agent when it has one, else each
agent's purpose to choose by, else nothing. An agent bound to no connection answers wherever it is asked and is
never routed to by connection.

Reads what is stored; no model.
"""
from __future__ import annotations

from typing import Any, Iterable

from pramanyx.custom_agents.reach import mcp_tool_name


def agents_for_connection(connection_id: str, agents: Iterable[Any]) -> list[dict]:
    """The enabled agents bound to ``connection_id``, each ``{id, name, purpose, tool}``, by name."""
    out = []
    for a in agents:
        if not getattr(a, "enabled", True) or not connection_id or getattr(a, "connection_id", "") != connection_id:
            continue
        out.append({"id": a.id, "name": a.name, "purpose": (getattr(a, "purpose", "") or "").strip(),
                    "tool": mcp_tool_name(a)})
    return sorted(out, key=lambda r: r["name"].lower())


def routing_words(agents: list[dict]) -> str:
    """What the coworker is told about a connection's agents, as a section of its instructions; "" for none."""
    if not agents:
        return ""
    if len(agents) == 1:
        a = agents[0]
        what = f" — {a['purpose']}" if a["purpose"] else ""
        return "\n".join([
            "## Its agent",
            "",
            f"This connection has its own agent, **{a['name']}**{what}. Ask a question about this data through "
            f"`{a['tool']}`: it answers by that agent's instructions and the definitions it is held to. Use `ask` only "
            "when the person asks for an answer without the agent.",
            "",
        ])
    lines = ["## Its agents", "", f"This connection has {len(agents)} agents. Ask a question through the one whose "
             "purpose fits it, and say which you asked:", ""]
    for a in agents:
        lines.append(f"- **{a['name']}** (`{a['tool']}`) — {a['purpose'] or 'no purpose written; its name says what it is for'}")
    lines += ["", "When none of them fits the question, use `ask`.", ""]
    return "\n".join(lines)

"""Displaying a schema must not rebuild the semantic index.

`apply_schema_enrichment` runs on every `get_schema` — the request that merely
DISPLAYS table and column names — and it called `build_schema_index`, which embeds
the whole schema. Where the embedder is unreachable that call retries with backoff,
so the display waits on work that cannot succeed.

Measured in production, one table of 21 columns, after the profiling phase had
already been moved off this path (#324):

    schema/rich          81.1s
    forced re-introspect 96.0s
    schema/rich again    79.9s

against **0.94s locally**, where the embedder answers. The logs name it directly:
`APIConnectionError: Connection error` and `Retrying request to /embeddings`.

Nothing is lost by removing it: the freshness this call existed for — after a glossary
change — now happens in the HEAVY phase, in the background, where the file itself says
such work belongs: "the schema hot-path never depends on the vector store unless explicitly turned on".
"""
from __future__ import annotations

import inspect

from pramanyx.tools import schema as schema_tools


def test_the_display_path_does_not_build_the_index():
    """The claim. `apply_schema_enrichment` is reached by every get_schema."""
    src = inspect.getsource(schema_tools.apply_schema_enrichment)
    assert "build_schema_index(" not in src, (
        "the schema display path rebuilds the semantic index — that is the 80s")







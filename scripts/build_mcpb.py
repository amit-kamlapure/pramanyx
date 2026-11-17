"""Pack the Pramanyx MCP bundle (punch list 95): ``python scripts/build_mcpb.py [out]`` → ``dist/pramanyx.mcpb``.

A bundle is a zip of ``packaging/mcpb`` — its manifest, icon and launcher. It carries no Pramanyx: the launcher runs the
MCP server of the install whose Python the person chooses in the extension's settings. Imports nothing of Pramanyx, so it
never opens a store. ``mcpb validate packaging/mcpb/manifest.json`` (the ``@anthropic-ai/mcpb`` CLI) checks the manifest
against the published schema where that CLI is installed; ``tests/unit/test_mcp_bundle.py`` checks what this repo can.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "packaging" / "mcpb"
FILES = ("manifest.json", "icon.png", "server/main.py")


def build(out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name in FILES:
            z.write(SOURCE / name, arcname=name)
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "pramanyx.mcpb"
    print(build(target))

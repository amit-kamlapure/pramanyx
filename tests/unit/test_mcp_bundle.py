"""The Pramanyx MCP bundle (punch list 95, 2026-11-18): Claude Desktop installs it in one click and asks for the install's
Python and API. Pinned here what the repo can check without the bundle CLI: the fields the MCPB manifest requires, every
`${user_config.*}` it uses declared, the key kept sensitive, the launcher it names packed, and its list of tools the
server's own — a tool added to the server is added here too, as a decision."""
from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "packaging" / "mcpb" / "manifest.json").read_text())


def test_the_manifest_carries_what_the_bundle_format_requires():
    for field in ("manifest_version", "name", "version", "description", "author", "server"):
        assert MANIFEST.get(field), field
    assert MANIFEST["author"]["name"] and MANIFEST["server"]["type"] == "python"
    assert re.fullmatch(r"\d+\.\d+\.\d+", MANIFEST["version"])
    assert (ROOT / "packaging" / "mcpb" / MANIFEST["server"]["entry_point"]).is_file()
    assert (ROOT / "packaging" / "mcpb" / MANIFEST["icon"]).is_file()


def test_every_setting_it_uses_is_declared_and_the_key_is_kept_secret():
    config = json.dumps(MANIFEST["server"]["mcp_config"])
    used = set(re.findall(r"\$\{user_config\.(\w+)\}", config))
    assert used == set(MANIFEST["user_config"]) == {"python", "api_url", "api_key"}
    assert MANIFEST["user_config"]["api_key"]["sensitive"] is True
    assert MANIFEST["server"]["mcp_config"]["env"]["PRAMANYX_API_KEY"] == "${user_config.api_key}"
    assert MANIFEST["server"]["mcp_config"]["command"] == "${user_config.python}"


def test_its_tools_are_the_server_s_own():
    from pramanyx.mcp.server import mcp
    listed = [t["name"] for t in MANIFEST["tools"]]
    assert len(listed) == len(set(listed))
    assert set(listed) == set(mcp._tool_manager._tools)
    assert MANIFEST["tools_generated"] is True, "the organisation's policy and its agents change what is offered"


def test_the_bundle_packs_the_manifest_icon_and_launcher(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_mcpb", ROOT / "scripts" / "build_mcpb.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = mod.build(tmp_path / "pramanyx.mcpb")
    with zipfile.ZipFile(out) as z:
        assert sorted(z.namelist()) == ["icon.png", "manifest.json", "server/main.py"]
        assert json.loads(z.read("manifest.json")) == MANIFEST

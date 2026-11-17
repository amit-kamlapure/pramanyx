"""The Pramanyx bundle's entry point (punch list 95, 2026-11-18): run the MCP server of the Pramanyx install whose Python
launched this, or say plainly that the chosen Python is not one. The bundle carries no Pramanyx of its own; the
install's code, settings and agent policy are what answer."""
import runpy
import sys

try:
    import pramanyx.mcp  # noqa: F401 — only to ask whether this Python is a Pramanyx install's
except ImportError:
    sys.stderr.write(
        "Pramanyx: this Python is not a Pramanyx install's. In the extension's settings, choose the python inside your "
        "install's virtual environment: <install>/.venv/bin/python (on Windows, <install>\\.venv\\Scripts\\python.exe).\n")
    sys.exit(1)

sys.argv = ["pramanyx.mcp"]
runpy.run_module("pramanyx.mcp", run_name="__main__", alter_sys=True)

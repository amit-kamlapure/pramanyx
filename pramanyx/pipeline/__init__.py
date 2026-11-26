"""NL→SQL generation (`sql_generate.generate_sql`) — the one `WRITE_SQL_PROMPT` call site,
read by the deep answer path (`agent/nodes.py`).

The generate→validate→execute→interpret template, its registry and its built-in
capabilities were removed 2026-11-27: only `POST /query/capability-answer` reached them,
and nothing called that route.
"""

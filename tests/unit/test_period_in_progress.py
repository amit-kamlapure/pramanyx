"""A last period still in progress is said as so far (found live, 2026-11-15: "November … a synchronized sharp drop …
the standout anomaly" on the 15th). Read from the result itself, at the executor, so every path is told."""
from __future__ import annotations

import inspect
from datetime import date

from pramanyx.sql.periods import last_period_in_progress as partial

TODAY = date(2026, 11, 15)


def test_a_month_still_running_is_said_and_a_finished_one_is_not():
    rows = [["2026-10", "Mytheresa", 262743.28], ["2026-11", "Mytheresa", 139823.70]]
    said = partial(["month", "platform", "gmv"], rows, TODAY)
    assert "November 2026, is still in progress" in said and "so far" in said
    assert partial(["month", "gmv"], [["2026-09", 1], ["2026-10", 2]], TODAY) is None


def test_the_grain_is_read_from_values_when_the_name_does_not_say():
    assert "November 2026" in partial(["d", "gmv"], [[date(2026, 9, 1), 1], [date(2026, 10, 1), 2], [date(2026, 11, 1), 3]], TODAY)
    assert "Q4 2026" in partial(["quarter", "n"], [["2026-Q3", 3], ["2026-Q4", 1]], TODAY)
    assert "the week of 2026-11-09" in partial(["w", "n"], [[date(2026, 11, 2), 3], [date(2026, 11, 9), 1]], TODAY)


def test_no_time_column_a_fiscal_year_or_one_row_carries_nothing():
    assert partial(["platform", "gmv"], [["a", 1], ["b", 2]], TODAY) is None
    assert partial(["fiscal_year", "gmv"], [[2026, 1], [2027, 2]], TODAY) is None   # its end is the business's
    assert partial(["month", "gmv"], [["2026-11", 1]], TODAY) is None


def test_the_executor_attaches_it_to_every_result():
    from pramanyx.sql import executor
    assert "last_period_in_progress" in inspect.getsource(executor)


def test_a_scheduled_runs_title_is_what_was_asked():
    from pramanyx.automations.temporal import OBSERVATION_HEADER
    from pramanyx.routers.investigations import _as_asked
    asked = f"{OBSERVATION_HEADER}\nThis is a scheduled daily run.\nObserve 2026-11-14 (UTC).\n\nSummarise GMV by platform."
    assert _as_asked([{"id": "a", "question": asked}, {"id": "b", "question": "Why did returns rise?"}]) == [
        {"id": "a", "question": "Summarise GMV by platform."}, {"id": "b", "question": "Why did returns rise?"}]

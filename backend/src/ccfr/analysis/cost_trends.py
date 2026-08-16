from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any, Literal

BucketSize = Literal["day", "week"]
MAX_TREND_BUCKETS = 3_660


class CostTrendRangeError(ValueError):
    """An invalid or excessive requested trend range."""


def _coerce_day(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _day_for_bucket_key(value: str, bucket_size: BucketSize) -> date | None:
    if bucket_size == "day":
        return _coerce_day(value)
    try:
        return datetime.strptime(f"{value}-1", "%Y-%W-%w").date()
    except ValueError:
        return None


def _bucket_key(day: date, bucket_size: BucketSize) -> str:
    return day.isoformat() if bucket_size == "day" else day.strftime("%Y-%W")


def _range_keys(
    observed: Mapping[str, Mapping[str, Any]],
    *,
    bucket_size: BucketSize,
    range_start: str | None,
    range_end: str | None,
) -> list[str]:
    start = _coerce_day(range_start)
    end = _coerce_day(range_end)
    if range_start is not None and start is None:
        raise CostTrendRangeError("date_from must begin with an ISO date (YYYY-MM-DD)")
    if range_end is not None and end is None:
        raise CostTrendRangeError("date_to must begin with an ISO date (YYYY-MM-DD)")
    observed_days = [
        day
        for key in observed
        if (day := _day_for_bucket_key(key, bucket_size)) is not None
    ]
    if start is None and observed_days:
        start = min(observed_days)
    if end is None and observed_days:
        end = max(observed_days)
    if start is None or end is None or end < start:
        return sorted(observed)

    step_days = 1 if bucket_size == "day" else 7
    bucket_count = ((end - start).days // step_days) + 1
    if bucket_count > MAX_TREND_BUCKETS:
        raise CostTrendRangeError(
            f"date range produces too many buckets (max {MAX_TREND_BUCKETS})"
        )

    keys: list[str] = []
    seen: set[str] = set()
    cursor = start
    while cursor <= end:
        key = _bucket_key(cursor, bucket_size)
        if key not in seen:
            keys.append(key)
            seen.add(key)
        cursor += timedelta(days=step_days)
    return keys


def build_cost_trend(
    observed: Mapping[str, Mapping[str, Any]],
    *,
    bucket_size: BucketSize,
    range_start: str | None,
    range_end: str | None,
    suppress_spikes: bool = False,
    max_spikes: int = 5,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Zero-fill cost buckets and identify evidence-qualified spend spikes."""
    over_time: list[dict[str, Any]] = []
    totals: list[float] = []
    spikes: list[dict[str, Any]] = []

    for key in _range_keys(
        observed,
        bucket_size=bucket_size,
        range_start=range_start,
        range_end=range_end,
    ):
        source = observed.get(key, {})
        per_model = {
            str(model): round(float(usd), 6)
            for model, usd in dict(source.get("per_model", {})).items()
            if float(usd) != 0
        }
        total_usd = round(sum(per_model.values()), 6)
        session_ids = set(source.get("session_ids", set()))
        priced_session_ids = set(source.get("priced_session_ids", set()))
        unpriced_session_ids = set(source.get("unpriced_session_ids", set()))
        fully_priced_session_ids = priced_session_ids - unpriced_session_ids
        unpriced_models = sorted(str(model) for model in source.get("unpriced_models", set()))
        contributors = sorted(
            (dict(session) for session in source.get("sessions", [])),
            key=lambda session: float(session.get("usd", 0) or 0),
            reverse=True,
        )[:3]
        for contributor in contributors:
            contributor["usd"] = round(float(contributor.get("usd", 0) or 0), 6)

        preceding = totals[-7:]
        baseline_usd = round(float(median(preceding)), 6) if len(preceding) >= 3 else None
        delta_usd = round(total_usd - baseline_usd, 6) if baseline_usd is not None else None
        delta_pct = (
            round((delta_usd / baseline_usd) * 100, 2)
            if delta_usd is not None and baseline_usd > 0
            else None
        )
        is_spike = bool(
            not suppress_spikes
            and baseline_usd is not None
            and len(fully_priced_session_ids) >= 2
            and delta_usd is not None
            and delta_usd >= 5
            and (baseline_usd == 0 or (delta_pct is not None and delta_pct >= 50))
        )

        row = {
            "bucket": key,
            "per_model": per_model,
            "total_usd": total_usd,
            "session_count": len(session_ids),
            "priced_session_count": len(fully_priced_session_ids),
            "unpriced_models": unpriced_models,
            "costs_are_lower_bound": bool(unpriced_models),
            "baseline_usd": baseline_usd,
            "delta_usd": delta_usd,
            "delta_pct": delta_pct,
            "is_spike": is_spike,
            "sessions": contributors,
        }
        over_time.append(row)
        totals.append(total_usd)
        if is_spike:
            spikes.append(
                {
                    "bucket": key,
                    "total_usd": total_usd,
                    "baseline_usd": baseline_usd,
                    "delta_usd": delta_usd,
                    "delta_pct": delta_pct,
                    "sessions": contributors,
                }
            )

    spikes.sort(key=lambda item: float(item["delta_usd"]), reverse=True)
    return over_time, spikes[:max_spikes]

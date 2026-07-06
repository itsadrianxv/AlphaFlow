"""Screening time period resolution helpers."""

from __future__ import annotations

from datetime import date
import re


def normalize_period_label(period: str) -> str:
    if re.fullmatch(r"\d{4}", period):
        return f"{period}-12-31"

    match = re.fullmatch(r"(\d{4})Q([1-4])", period)
    if not match:
        return period

    year = match.group(1)
    quarter = match.group(2)
    month_day = {
        "1": "03-31",
        "2": "06-30",
        "3": "09-30",
        "4": "12-31",
    }
    return f"{year}-{month_day[quarter]}"


def resolve_periods(time_config: dict[str, str], today: date | None = None) -> list[str]:
    reference_date = today or date.today()
    period_type = time_config["periodType"]
    range_mode = time_config["rangeMode"]

    if range_mode == "CUSTOM":
        start = time_config.get("customStart", "")
        end = time_config.get("customEnd", "")
        if period_type == "ANNUAL" and start.isdigit() and end.isdigit():
            start_year = int(start)
            end_year = int(end)
            return [str(year) for year in range(start_year, end_year + 1)]
        if period_type == "QUARTERLY":
            return _quarter_range(start, end)
        return [value for value in [start, end] if value]

    if period_type == "ANNUAL":
        count = {"1Y": 1, "3Y": 3, "5Y": 5}[time_config["presetKey"]]
        end_year = reference_date.year - 1
        return [str(year) for year in range(end_year - count + 1, end_year + 1)]

    count = {"4Q": 4, "8Q": 8, "12Q": 12}[time_config["presetKey"]]
    current_quarter = ((reference_date.month - 1) // 3) + 1
    year = reference_date.year
    quarter = current_quarter - 1
    if quarter == 0:
        quarter = 4
        year -= 1

    periods: list[str] = []
    for _ in range(count):
        periods.append(f"{year}Q{quarter}")
        quarter -= 1
        if quarter == 0:
            quarter = 4
            year -= 1
    return list(reversed(periods))


def _quarter_range(start: str, end: str) -> list[str]:
    start_match = re.fullmatch(r"(\d{4})Q([1-4])", start)
    end_match = re.fullmatch(r"(\d{4})Q([1-4])", end)
    if not start_match or not end_match:
        return [value for value in [start, end] if value]

    year = int(start_match.group(1))
    quarter = int(start_match.group(2))
    end_year = int(end_match.group(1))
    end_quarter = int(end_match.group(2))

    periods: list[str] = []
    while year < end_year or (year == end_year and quarter <= end_quarter):
        periods.append(f"{year}Q{quarter}")
        quarter += 1
        if quarter == 5:
            quarter = 1
            year += 1
    return periods

"""作業枠の候補を出す（DB に触らない純粋な関数）。

  - 期限までの平日（勤務時間 9:00〜18:00、昼休み 12:00〜13:00 を除く）の空き時間から、
    必要な作業時間がまるごと入る枠を、早い順に最大5つ出す。
  - 会議・登録済みの作業枠と重なる時間は使わない。
  - 期限までに入る枠がなければ enough=False とし、期限までに使える空き時間を返す
    （画面では「速報版を先に出す」「期限を相談する」を選べるようにする）。
"""
from datetime import datetime, timedelta

from app.planning.slots import LUNCH, WORK_END, WORK_START

MAX_DAYS = 5          # 何営業日先まで探すか
MAX_CANDIDATES = 5


def _busy_for_day(events: list[dict], day, tz) -> list[tuple[datetime, datetime]]:
    busy = [(datetime.combine(day, LUNCH[0], tzinfo=tz), datetime.combine(day, LUNCH[1], tzinfo=tz))]
    for e in events:
        s, t = datetime.fromisoformat(e["start_at"]), datetime.fromisoformat(e["end_at"])
        if s.date() == day:
            busy.append((s, t))
    return sorted(busy)


def free_ranges(events: list[dict], day, now: datetime) -> list[tuple[datetime, datetime]]:
    """ある日の空き時間（今より後、勤務時間内）。"""
    tz = now.tzinfo
    start = datetime.combine(day, WORK_START, tzinfo=tz)
    end = datetime.combine(day, WORK_END, tzinfo=tz)
    cursor = max(start, now)
    out = []
    for s, t in _busy_for_day(events, day, tz):
        if s > cursor:
            out.append((cursor, min(s, end)))
        cursor = max(cursor, t)
    if cursor < end:
        out.append((cursor, end))
    return [(a, b) for a, b in out if b > a]


def _business_days(now: datetime, n: int):
    d, out = now.date(), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def plan(events: list[dict], now: datetime, effort: int | None, deadline: str | None) -> dict:
    """作業時間と期限から、作業枠の候補と、足りるかどうかを返す。"""
    if not effort:
        return {"needs_effort": True, "candidates": [], "enough": None, "free_before_deadline": None}
    due = datetime.fromisoformat(deadline) if deadline else None
    need = timedelta(minutes=effort)
    candidates, free_before = [], 0
    for day in _business_days(now, MAX_DAYS):
        for a, b in free_ranges(events, day, now):
            if due and a < due:
                free_before += int((min(b, due) - a).total_seconds() // 60)
            if b - a >= need and len(candidates) < MAX_CANDIDATES:
                end = a + need
                candidates.append({"start": a.isoformat(), "end": end.isoformat(), "minutes": effort,
                                   "before_deadline": due is None or end <= due})
    in_time = [c for c in candidates if c["before_deadline"]]
    return {
        "needs_effort": False,
        "effort": effort,
        "deadline": deadline,
        "candidates": candidates,
        "enough": bool(in_time),
        "free_before_deadline": free_before if due else None,
        # 期限に間に合わないとき、最初に作業を終えられる時刻（相談の返信案で使う）
        "earliest_finish": candidates[0]["end"] if candidates and not in_time else None,
    }


def overlaps(events: list[dict], start: datetime, end: datetime) -> list[dict]:
    """登録しようとする時間と重なる予定（会議・作業枠・昼休み）。"""
    tz = start.tzinfo
    hits = [e for e in events if datetime.fromisoformat(e["start_at"]) < end and start < datetime.fromisoformat(e["end_at"])]
    lunch_s = datetime.combine(start.date(), LUNCH[0], tzinfo=tz)
    lunch_e = datetime.combine(start.date(), LUNCH[1], tzinfo=tz)
    if lunch_s < end and start < lunch_e:
        hits.append({"title": "昼休み", "start_at": lunch_s.isoformat(), "end_at": lunch_e.isoformat()})
    return hits


def within_work_hours(start: datetime, end: datetime) -> bool:
    return (start.date() == end.date() and start.weekday() < 5
            and start.time() >= WORK_START and end.time() <= WORK_END and end > start)

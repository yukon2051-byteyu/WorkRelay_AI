"""予定表から空き時間を計算する。

勤務時間は 9:00〜18:00、昼休みは 12:00〜13:00 とする（デモの前提）。
会議だけでなく、登録済みの作業枠も「埋まっている時間」として扱う。
"""
from datetime import datetime, time, timedelta

WORK_START = time(9, 0)
WORK_END = time(18, 0)
LUNCH = (time(12, 0), time(13, 0))


def _at(day, t: time, tz) -> datetime:
    return datetime.combine(day, t, tzinfo=tz)


def free_slots(events: list[dict], now: datetime) -> list[tuple[datetime, datetime]]:
    """今から終業までの空き時間の一覧（開始, 終了）を返す。"""
    day, tz = now.date(), now.tzinfo
    busy = [(_at(day, LUNCH[0], tz), _at(day, LUNCH[1], tz))]
    for e in events:
        s, t = datetime.fromisoformat(e["start_at"]), datetime.fromisoformat(e["end_at"])
        if s.date() == day:
            busy.append((s, t))
    busy.sort()

    slots, cursor = [], max(now, _at(day, WORK_START, tz))
    end_of_day = _at(day, WORK_END, tz)
    for s, t in busy:
        if s > cursor:
            slots.append((cursor, min(s, end_of_day)))
        cursor = max(cursor, t)
    if cursor < end_of_day:
        slots.append((cursor, end_of_day))
    return [(s, t) for s, t in slots if t > s]


def free_minutes_until(slots: list[tuple[datetime, datetime]], deadline: datetime) -> int:
    """期限までに使える空き時間（分）。"""
    total = timedelta()
    for s, t in slots:
        if s >= deadline:
            break
        total += min(t, deadline) - s
    return int(total.total_seconds() // 60)

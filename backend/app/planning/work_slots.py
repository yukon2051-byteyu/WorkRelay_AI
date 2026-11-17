"""作業枠：候補の提示と、利用者の操作による予定表への登録・取り消し。

予定の登録は、画面で対象と日時を確認した利用者の操作からだけ行う（自動では登録しない）。
デモでは「デモ内の予定表」（events テーブル）に登録する。実連携では Outlook の予定表に登録する予定。
"""
import sqlite3
from datetime import datetime

from app import config
from app.drafts.templates import fmt
from app.intake.service import add_history
from app.planning import schedule

OPEN_STATUSES = ("needs_info", "waiting_reply", "ready", "in_progress")


def _events(conn, source: str) -> list[dict]:
    return [dict(e) for e in conn.execute("SELECT * FROM events WHERE source = ? ORDER BY start_at", (source,))]


def slot_plan(conn: sqlite3.Connection, request_id: int) -> dict:
    req = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    if req is None:
        raise LookupError("依頼が見つかりません")
    now = config.now()
    deadline = req["committed_due"] or req["requested_due"]
    p = schedule.plan(_events(conn, req["source"]), now, req["effort_minutes"], deadline)
    p["deadline_label"] = fmt(deadline, now) if deadline else None
    p["options"] = []
    if p["enough"] is False:
        # 期限までに作業時間が足りない：選べる対応
        if req["type_code"] == "document":
            p["options"].append({"kind": "quick", "label": "速報版を先に出す",
                                 "description": f"{p['deadline_label']}までの空き{p['free_before_deadline']}分で速報版を作り、確定版は後から出す"})
        p["options"].append({"kind": "consult", "label": "期限を相談する",
                             "description": "相手に、速報版で足りるか・期限を延ばせるかを相談する返信案を作る"})
    return p


def register(conn: sqlite3.Connection, request_id: int, start: str, end: str) -> dict:
    """利用者が選んだ枠を、デモ内の予定表に作業枠として登録する。"""
    req = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    if req is None:
        raise LookupError("依頼が見つかりません")
    if req["status"] not in OPEN_STATUSES:
        raise ValueError("完了した依頼には作業枠を登録できません")
    s, e = datetime.fromisoformat(start), datetime.fromisoformat(end)  # 日時として読めなければ ValueError
    now = config.now()
    if s.tzinfo is None or e.tzinfo is None:
        raise ValueError("日時にはタイムゾーン（+09:00 など）を付けてください")
    if not schedule.within_work_hours(s, e):
        raise ValueError("作業枠は、平日の勤務時間（9:00〜18:00）の中で、終了が開始より後になるように指定してください")
    if s < now:
        raise ValueError("過去の時間には登録できません")
    clash = schedule.overlaps(_events(conn, req["source"]), s, e)
    if clash:
        names = "、".join(f"{c['title']}（{c['start_at'][11:16]}–{c['end_at'][11:16]}）" for c in clash)
        raise ValueError(f"ほかの予定と重なっています：{names}")
    at = now.isoformat()
    cur = conn.execute(
        "INSERT INTO events (source, external_id, title, start_at, end_at, kind, ingested_at, request_id) "
        "VALUES (?, ?, ?, ?, ?, 'work', ?, ?)",
        (req["source"], f"workrelay-{request_id}-{s.isoformat()}", f"【作業】{req['title']}",
         s.isoformat(), e.isoformat(), at, request_id))
    add_history(conn, request_id, at, "user", "slot",
                note=f"作業枠を予定表に登録：{fmt(s.isoformat(), now)}–{e:%H:%M}（デモ内の予定表）")
    conn.commit()
    return dict(conn.execute("SELECT * FROM events WHERE id = ?", (cur.lastrowid,)).fetchone())


def unregister(conn: sqlite3.Connection, event_id: int) -> None:
    ev = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if ev is None:
        raise LookupError("予定が見つかりません")
    if ev["kind"] != "work" or ev["request_id"] is None:
        raise ValueError("取り消せるのは、依頼のために登録した作業枠だけです（会議は取り消せません）")
    now = config.now()
    conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
    add_history(conn, ev["request_id"], now.isoformat(), "user", "slot",
                note=f"作業枠の登録を取り消し：{fmt(ev['start_at'], now)}–{ev['end_at'][11:16]}")
    conn.commit()

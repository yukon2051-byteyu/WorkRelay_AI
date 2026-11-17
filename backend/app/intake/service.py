"""依頼の受付と進行を DB に反映する処理。

1通ずつ、次の順番で判定する。
  1. 自分が送ったメール      … 同じスレッドの依頼を「返信待ち」にする
  2. 不審な連絡              … 「要注意」として記録するだけ。本文の指示は実行しない
  3. 同じスレッドの依頼がある … 回答・条件変更として依頼に反映する
  4. 別チャネルで関連しそう   … 「関連候補」として利用者の判断を待つ（自動では反映しない）
  5. それ以外                 … 新規依頼か対応不要かを分類する

重要なルール
  - 期限の前倒しを検知しても、確定期限（committed_due）は変えない。
    「変更の相談が必要」の印を付け、利用者が判断したときだけ変える。
  - 必要な項目がすべてそろったときだけ「着手可能」にする。返信が来ただけでは変えない。
"""
import json
import sqlite3
from datetime import datetime

from app.config import now
from app.intake import rules

DUE_FIELD = "提出希望日時"
OPEN_STATUSES = ("needs_info", "waiting_reply", "ready", "in_progress")
STATUS_LABELS = {
    "needs_info": "情報不足（未確認）",
    "waiting_reply": "返信待ち",
    "ready": "着手可能",
    "in_progress": "作業中",
    "done": "完了",
}


# ---------------------------------------------------------------- 共通の小道具

def ensure_request_types(conn: sqlite3.Connection) -> None:
    for code, t in rules.DEFAULT_REQUEST_TYPES.items():
        conn.execute(
            "INSERT INTO request_types (code, name, required_fields) VALUES (?, ?, ?) "
            "ON CONFLICT (code) DO NOTHING",
            (code, t["name"], json.dumps(t["required_fields"], ensure_ascii=False)),
        )


def required_fields(conn: sqlite3.Connection, type_code: str) -> list[str]:
    row = conn.execute("SELECT required_fields FROM request_types WHERE code = ?", (type_code,)).fetchone()
    return json.loads(row["required_fields"])


def add_history(conn, request_id, at, actor, kind, field=None, old=None, new=None, message_id=None, note=None):
    conn.execute(
        "INSERT INTO request_history (request_id, at, actor, kind, field, old_value, new_value, message_id, note) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (request_id, at, actor, kind, field, old, new, message_id, note),
    )


def _classify_message(conn, message_id, category, reason, request_id=None):
    conn.execute(
        "INSERT INTO message_classes (message_id, category, reason, request_id) VALUES (?, ?, ?, ?) "
        "ON CONFLICT (message_id) DO UPDATE SET category = excluded.category, "
        "reason = excluded.reason, request_id = excluded.request_id",
        (message_id, category, reason, request_id),
    )


def _link(conn, request_id, message_id, role, linked_by):
    conn.execute(
        "INSERT INTO request_messages (request_id, message_id, role, linked_by) VALUES (?, ?, ?, ?) "
        "ON CONFLICT DO NOTHING",
        (request_id, message_id, role, linked_by),
    )


def _set_status(conn, request_id, new_status, at, actor, note=None):
    old = conn.execute("SELECT status FROM requests WHERE id = ?", (request_id,)).fetchone()["status"]
    if old == new_status:
        return
    conn.execute("UPDATE requests SET status = ?, updated_at = ? WHERE id = ?", (new_status, at, request_id))
    add_history(conn, request_id, at, actor, "status", "状態",
                STATUS_LABELS.get(old, old), STATUS_LABELS.get(new_status, new_status), note=note)


def recompute_status(conn, request_id, at, actor="system"):
    """必要な項目がそろったかで、状態を見直す。"""
    req = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    missing = conn.execute(
        "SELECT COUNT(*) AS n FROM request_fields WHERE request_id = ? AND state != 'filled' AND name IN "
        "(SELECT value FROM json_each((SELECT required_fields FROM request_types WHERE code = ?)))",
        (request_id, req["type_code"]),
    ).fetchone()["n"]
    if missing == 0 and req["status"] in ("needs_info", "waiting_reply"):
        _set_status(conn, request_id, "ready", at, actor, note="必要な項目がすべてそろった")
    elif missing > 0 and req["status"] == "ready":
        _set_status(conn, request_id, "needs_info", at, actor, note=f"不足している項目が{missing}件ある")


# ---------------------------------------------------------------- 依頼の作成と更新

def create_request(conn, msg, cls: rules.Classification) -> int:
    at = msg["received_at"]
    found = cls.fields
    due = found.get(DUE_FIELD)
    cur = conn.execute(
        "INSERT INTO requests (source, type_code, title, requester_email, requester_name, requested_due, "
        "committed_due, status, origin_message_id, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, NULL, 'needs_info', ?, ?, ?)",
        (msg["source"], cls.type_code, cls.title, msg["sender_email"], msg["sender_name"],
         due.value if due else None, msg["id"], at, at),
    )
    request_id = cur.lastrowid
    for name in required_fields(conn, cls.type_code):
        fv = found.get(name)
        if fv and fv.value:
            state = "filled"
        elif fv and fv.deferred:
            state = "deferred"
        else:
            state = "missing"
        conn.execute(
            "INSERT INTO request_fields (request_id, name, value, state, confidence, evidence_message_id, "
            "evidence_text, missing_initially) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (request_id, name, fv.value if fv else None, state, fv.confidence if fv else None,
             msg["id"] if fv else None, fv.evidence if fv else None, 0 if state == "filled" else 1),
        )
    _link(conn, request_id, msg["id"], "origin", "thread")
    add_history(conn, request_id, at, "ai", "received", message_id=msg["id"], note=cls.reason)
    recompute_status(conn, request_id, at, actor="ai")
    return request_id


def apply_message(conn, request_id, msg, linked_by: str, actor: str = "ai") -> str:
    """既存の依頼に、回答・条件変更のメッセージを反映する。分類名を返す。"""
    at = msg["received_at"]
    req = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    base = datetime.fromisoformat(msg["received_at"])
    found = rules.extract_fields(req["type_code"], msg["body"], msg.get("subject"), base)
    fields = {r["name"]: r for r in conn.execute("SELECT * FROM request_fields WHERE request_id = ?", (request_id,))}

    answered, changed = [], []
    for name, fv in found.items():
        cur = fields.get(name)
        if cur is None:
            continue  # 必要項目でないものは無視
        if fv.value and cur["state"] == "filled" and fv.value != cur["value"]:
            # すでに値があるのに違う値が来た → 条件の変更
            changed.append(name)
            conn.execute(
                "UPDATE request_fields SET value = ?, confidence = ?, evidence_message_id = ?, evidence_text = ? "
                "WHERE id = ?", (fv.value, fv.confidence, msg["id"], fv.evidence, cur["id"]))
            add_history(conn, request_id, at, actor, "due" if name == DUE_FIELD else "field", name,
                        cur["value"], fv.value, msg["id"], note="依頼者からの変更を検知")
            if name == DUE_FIELD:
                conn.execute(
                    "UPDATE requests SET requested_due = ?, due_change_status = 'needs_consult', updated_at = ? "
                    "WHERE id = ?", (fv.value, at, request_id))
                add_history(conn, request_id, at, "system", "decision", note=(
                    "希望期限が変わったため『変更の相談が必要』。利用者が確認するまで確定期限と作業枠は維持"))
        elif fv.value and cur["state"] != "filled":
            answered.append(name)
            conn.execute(
                "UPDATE request_fields SET value = ?, state = 'filled', confidence = ?, evidence_message_id = ?, "
                "evidence_text = ? WHERE id = ?", (fv.value, fv.confidence, msg["id"], fv.evidence, cur["id"]))
            add_history(conn, request_id, at, actor, "field", name, None, fv.value, msg["id"], note="回答で記入")
            if name == DUE_FIELD:
                conn.execute("UPDATE requests SET requested_due = ? WHERE id = ?", (fv.value, request_id))
        elif fv.deferred and cur["state"] == "missing":
            conn.execute(
                "UPDATE request_fields SET state = 'deferred', evidence_message_id = ?, evidence_text = ? "
                "WHERE id = ?", (msg["id"], fv.evidence, cur["id"]))
            add_history(conn, request_id, at, actor, "field", name, None, None, msg["id"],
                        note="依頼者が後で回答予定（未記入のまま）")
            answered.append(name)

    category = "change" if changed else ("answer" if answered else "related")
    _link(conn, request_id, msg["id"], category, linked_by)
    conn.execute("UPDATE requests SET updated_at = ? WHERE id = ?", (at, request_id))
    recompute_status(conn, request_id, at, actor="ai")
    return category


# ---------------------------------------------------------------- メッセージの処理

def _thread_request(conn, msg) -> int | None:
    """同じスレッド（メールの会話ID）に結びついた依頼を探す。"""
    if not msg["conversation_id"]:
        return None
    row = conn.execute(
        "SELECT rm.request_id FROM request_messages rm JOIN messages m ON m.id = rm.message_id "
        "WHERE m.source = ? AND m.channel = ? AND m.conversation_id = ? LIMIT 1",
        (msg["source"], msg["channel"], msg["conversation_id"]),
    ).fetchone()
    return row["request_id"] if row else None


def process_message(conn, msg: dict) -> str:
    base = datetime.fromisoformat(msg["received_at"])
    thread_req = _thread_request(conn, msg)

    # 1. 自分が送ったメール
    if msg["direction"] == "sent":
        if thread_req:
            _link(conn, thread_req, msg["id"], "question", "thread")
            add_history(conn, thread_req, msg["received_at"], "user", "question_sent", message_id=msg["id"],
                        note="不足情報の確認を送信")
            req = conn.execute("SELECT status FROM requests WHERE id = ?", (thread_req,)).fetchone()
            if req["status"] == "needs_info":
                _set_status(conn, thread_req, "waiting_reply", msg["received_at"], "user", note="確認を送信した")
        _classify_message(conn, msg["id"], "sent", "自分が送信したメッセージ", thread_req)
        return "sent"

    # 2. 不審な連絡（どの判定よりも先に止める）
    reason = rules.check_suspicious(msg)
    if reason:
        _classify_message(conn, msg["id"], "suspicious", reason)
        return "suspicious"

    # 3. 同じスレッドの依頼がある
    if thread_req:
        category = apply_message(conn, thread_req, msg, linked_by="thread")
        _classify_message(conn, msg["id"], category, "同じメールスレッドの依頼への返信", thread_req)
        return category

    # 4. 別チャネルの関連候補（利用者の判断待ち）
    open_reqs = conn.execute(
        f"SELECT * FROM requests WHERE source = ? AND status IN ({','.join('?' * len(OPEN_STATUSES))})",
        (msg["source"], *OPEN_STATUSES),
    ).fetchall()
    for req in open_reqs:
        reasons = rules.relation_reasons(msg, dict(req))
        if rules.is_relation_candidate(reasons):
            conn.execute(
                "INSERT INTO relation_candidates (message_id, request_id, reasons, status) VALUES (?, ?, ?, 'pending') "
                "ON CONFLICT DO NOTHING",
                (msg["id"], req["id"], json.dumps(reasons, ensure_ascii=False)),
            )
            add_history(conn, req["id"], msg["received_at"], "ai", "link", message_id=msg["id"],
                        note="同一依頼の候補を検出（利用者の判断待ち）：" + "／".join(reasons))
            _classify_message(conn, msg["id"], "candidate", "既存の依頼と同じ案件の候補", req["id"])
            return "candidate"

    # 5. 新規依頼か対応不要か
    cls = rules.classify(msg, base)
    if cls.category == "new_request":
        request_id = create_request(conn, msg, cls)
        _classify_message(conn, msg["id"], "new_request", cls.reason, request_id)
    else:
        _classify_message(conn, msg["id"], cls.category, cls.reason)
    return cls.category


def process_messages(conn, source: str, until: str | None = None) -> dict:
    """まだ分類していないメッセージを、古い順に処理する。再実行しても二重に処理しない。"""
    ensure_request_types(conn)
    sql = ("SELECT * FROM messages WHERE source = ? AND id NOT IN (SELECT message_id FROM message_classes)")
    params: list = [source]
    if until:
        sql += " AND received_at <= ?"
        params.append(until)
    sql += " ORDER BY received_at, id"
    counts: dict[str, int] = {}
    for row in conn.execute(sql, params).fetchall():
        category = process_message(conn, dict(row))
        counts[category] = counts.get(category, 0) + 1
    conn.commit()
    return counts


# ---------------------------------------------------------------- 利用者の操作

def decide_candidate(conn, candidate_id: int, accept: bool) -> dict:
    cand = conn.execute("SELECT * FROM relation_candidates WHERE id = ?", (candidate_id,)).fetchone()
    if cand is None:
        raise LookupError("関連候補が見つかりません")
    if cand["status"] != "pending":
        raise ValueError("この候補はすでに判断済みです")
    at = now().isoformat()
    msg = dict(conn.execute("SELECT * FROM messages WHERE id = ?", (cand["message_id"],)).fetchone())
    conn.execute("UPDATE relation_candidates SET status = ?, decided_at = ? WHERE id = ?",
                 ("accepted" if accept else "rejected", at, candidate_id))
    if accept:
        add_history(conn, cand["request_id"], at, "user", "link", message_id=msg["id"],
                    note="利用者が同一の依頼と判断")
        category = apply_message(conn, cand["request_id"], msg, linked_by="user")
        _classify_message(conn, msg["id"], category, "利用者が同一の依頼と判断", cand["request_id"])
    else:
        add_history(conn, cand["request_id"], at, "user", "link", message_id=msg["id"],
                    note="利用者が別の案件と判断")
        cls = rules.classify(msg, datetime.fromisoformat(msg["received_at"]))
        if cls.category == "new_request":
            new_id = create_request(conn, msg, cls)
            _classify_message(conn, msg["id"], "new_request", "利用者が別件と判断し、新規依頼として登録", new_id)
        else:
            _classify_message(conn, msg["id"], cls.category, "利用者が別件と判断：" + cls.reason)
    conn.commit()
    return get_request(conn, cand["request_id"])


def decide_due_change(conn, request_id: int, decision: str, committed_due: str | None = None) -> dict:
    """期限変更の相談に対する利用者の判断。accept / keep / custom。"""
    req = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    if req is None:
        raise LookupError("依頼が見つかりません")
    if decision == "accept":
        new_due = req["requested_due"]
    elif decision == "keep":
        new_due = req["committed_due"]
    elif decision == "custom":
        if not committed_due:
            raise ValueError("custom の場合は committed_due が必要です")
        datetime.fromisoformat(committed_due)  # 日時として読めるか確認（読めなければ ValueError）
        new_due = committed_due
    else:
        raise ValueError(f"不明な判断です: {decision}")
    at = now().isoformat()
    if new_due != req["committed_due"]:
        add_history(conn, request_id, at, "user", "due", "確定期限", req["committed_due"], new_due)
    add_history(conn, request_id, at, "user", "decision", note=f"期限変更の相談に回答：{decision}")
    conn.execute("UPDATE requests SET committed_due = ?, due_change_status = NULL, updated_at = ? WHERE id = ?",
                 (new_due, at, request_id))
    conn.commit()
    return get_request(conn, request_id)


def update_request(conn, request_id: int, changes: dict) -> dict:
    """利用者による手動の変更（状態・作業時間・項目の値）。すべて履歴に残す。"""
    req = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    if req is None:
        raise LookupError("依頼が見つかりません")
    at = now().isoformat()
    if "status" in changes:
        if changes["status"] not in STATUS_LABELS:
            raise ValueError(f"不明な状態です: {changes['status']}")
        _set_status(conn, request_id, changes["status"], at, "user")
    if "effort_minutes" in changes:
        minutes = changes["effort_minutes"]
        if minutes is not None and (not isinstance(minutes, int) or minutes <= 0):
            raise ValueError("作業時間は1以上の整数（分）で入力してください")
        add_history(conn, request_id, at, "user", "field", "作業時間（分）", req["effort_minutes"], minutes)
        conn.execute("UPDATE requests SET effort_minutes = ? WHERE id = ?", (minutes, request_id))
    for name, value in (changes.get("fields") or {}).items():
        cur = conn.execute("SELECT * FROM request_fields WHERE request_id = ? AND name = ?",
                           (request_id, name)).fetchone()
        if cur is None:
            raise ValueError(f"この依頼に項目『{name}』はありません")
        state = "filled" if value else "missing"
        conn.execute("UPDATE request_fields SET value = ?, state = ?, confidence = 'confirmed', "
                     "evidence_message_id = NULL, evidence_text = '利用者が入力' WHERE id = ?",
                     (value or None, state, cur["id"]))
        add_history(conn, request_id, at, "user", "field", name, cur["value"], value or None)
    conn.execute("UPDATE requests SET updated_at = ? WHERE id = ?", (at, request_id))
    recompute_status(conn, request_id, at, actor="user")
    conn.commit()
    return get_request(conn, request_id)


def set_required_fields(conn, type_code: str, fields: list[str]) -> dict:
    """依頼種別の必要項目を変更し、未完了の依頼に不足項目を追加する。"""
    if not fields or any(not f.strip() for f in fields):
        raise ValueError("必要項目を1つ以上、空でない名前で指定してください")
    ensure_request_types(conn)
    if conn.execute("SELECT 1 FROM request_types WHERE code = ?", (type_code,)).fetchone() is None:
        raise LookupError("依頼種別が見つかりません")
    conn.execute("UPDATE request_types SET required_fields = ? WHERE code = ?",
                 (json.dumps(fields, ensure_ascii=False), type_code))
    at = now().isoformat()
    rows = conn.execute(
        f"SELECT id FROM requests WHERE type_code = ? AND status IN ({','.join('?' * len(OPEN_STATUSES))})",
        (type_code, *OPEN_STATUSES)).fetchall()
    for r in rows:
        for name in fields:
            conn.execute("INSERT INTO request_fields (request_id, name, state) VALUES (?, ?, 'missing') "
                         "ON CONFLICT DO NOTHING", (r["id"], name))
        recompute_status(conn, r["id"], at)
    conn.commit()
    return {"code": type_code, "required_fields": fields}


# ---------------------------------------------------------------- 持ち越し（前日までの利用者の判断）

def apply_carryover(conn, decisions: list[dict], source: str) -> None:
    """前日までに利用者がアプリで行った判断（確定期限・作業時間・作業枠）を再現する。"""
    for d in decisions:
        row = conn.execute(
            "SELECT r.* FROM requests r JOIN messages m ON m.id = r.origin_message_id "
            "WHERE m.source = ? AND m.external_id = ?", (source, d["origin_external_id"])).fetchone()
        if row is None:
            raise LookupError(f"持ち越し依頼の元メールがありません: {d['origin_external_id']}")
        conn.execute("UPDATE requests SET committed_due = ?, effort_minutes = ? WHERE id = ?",
                     (d["committed_due"], d.get("effort_minutes"), row["id"]))
        add_history(conn, row["id"], d["at"], "user", "due", "確定期限", None, d["committed_due"],
                    note="担当者が引き受けた期限")
        if d.get("work_event_external_id"):
            conn.execute("UPDATE events SET request_id = ? WHERE source = ? AND external_id = ?",
                         (row["id"], source, d["work_event_external_id"]))
            add_history(conn, row["id"], d["at"], "user", "decision", note="作業枠を予定表に登録済み")
    conn.commit()


# ---------------------------------------------------------------- 参照

def _request_summary(conn, r) -> dict:
    d = dict(r)
    d["status_label"] = STATUS_LABELS.get(d["status"], d["status"])
    d["type_name"] = conn.execute("SELECT name FROM request_types WHERE code = ?", (d["type_code"],)).fetchone()["name"]
    d["missing_fields"] = [x["name"] for x in conn.execute(
        "SELECT name FROM request_fields WHERE request_id = ? AND state != 'filled' ORDER BY id", (d["id"],))]
    d["pending_candidates"] = conn.execute(
        "SELECT COUNT(*) AS n FROM relation_candidates WHERE request_id = ? AND status = 'pending'",
        (d["id"],)).fetchone()["n"]
    return d


def list_requests(conn, source: str) -> list[dict]:
    rows = conn.execute("SELECT * FROM requests WHERE source = ? ORDER BY id", (source,)).fetchall()
    return [_request_summary(conn, r) for r in rows]


def get_request(conn, request_id: int) -> dict:
    r = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    if r is None:
        raise LookupError("依頼が見つかりません")
    d = _request_summary(conn, r)
    d["fields"] = [dict(x) for x in conn.execute(
        "SELECT * FROM request_fields WHERE request_id = ? ORDER BY id", (request_id,))]
    d["messages"] = [dict(x) for x in conn.execute(
        "SELECT m.*, rm.role, rm.linked_by FROM request_messages rm JOIN messages m ON m.id = rm.message_id "
        "WHERE rm.request_id = ? ORDER BY m.received_at", (request_id,))]
    cands = []
    for c in conn.execute("SELECT * FROM relation_candidates WHERE request_id = ? ORDER BY id", (request_id,)):
        c = dict(c)
        c["reasons"] = json.loads(c["reasons"])
        c["message"] = dict(conn.execute("SELECT * FROM messages WHERE id = ?", (c["message_id"],)).fetchone())
        # この候補を「同じ依頼」とつないだ場合に変わる値（期限など）と、元メッセージ内の強調箇所
        found = rules.extract_fields(d["type_code"], c["message"]["body"], c["message"]["subject"],
                                     datetime.fromisoformat(c["message"]["received_at"]))
        current = {f["name"]: f["value"] for f in d["fields"]}
        # 今の値と違う（つなぐと変わる・埋まる）値だけを候補の提案として扱う
        c["proposed_values"] = {k: v.value for k, v in found.items() if v.value and current.get(k) != v.value}
        c["highlights"] = rules.relation_highlights(
            c["message"]["body"], d, {k: v for k, v in c["proposed_values"].items() if k != DUE_FIELD})
        cands.append(c)
    d["candidates"] = cands
    d["history"] = [dict(x) for x in conn.execute(
        "SELECT * FROM request_history WHERE request_id = ? ORDER BY at, id", (request_id,))]
    d["work_slots"] = [dict(x) for x in conn.execute(
        "SELECT * FROM events WHERE request_id = ? ORDER BY start_at", (request_id,))]
    return d

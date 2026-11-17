"""下書きの作成・編集・保存・送信の記録。

守るルール
  - 下書きは「作るだけ」。保存（Outlookの下書き）と送信は、利用者の操作でのみ行う。
  - 利用者が編集した本文は、作り直しても上書きしない（新しい案は別に持つ）。
  - 作成時の条件（basis）を記録し、条件が変わったら「更新内容の確認が必要」と知らせる。
  - 保存と送信は別の状態として扱う。
"""
import json
import sqlite3
from datetime import datetime

from app import config
from app.drafts import templates as t
from app.intake import rules
from app.intake.service import add_history, _link, _set_status
from app.planning.slots import free_minutes_until, free_slots

OPEN_STATUSES = ("needs_info", "waiting_reply", "ready", "in_progress")
BASIS_LABELS = {"committed_due": "確定期限", "wish_due": "希望期限", "effort": "作業時間（分）", "missing": "不足項目"}


# ---------------------------------------------------------------- 条件の読み取り

def _context(conn: sqlite3.Connection, request_id: int, now: datetime) -> dict:
    req = dict(conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone())
    fields = {f["name"]: dict(f) for f in conn.execute("SELECT * FROM request_fields WHERE request_id = ?", (request_id,))}
    origin = dict(conn.execute("SELECT * FROM messages WHERE id = ?", (req["origin_message_id"],)).fetchone())

    # 判断待ちの関連候補にある期限（まだ依頼には反映していないもの）
    proposed_due, proposed_channel = None, None
    candidate_fills: set[str] = set()  # 判断待ちの候補で埋まる見込みの項目（重ねて聞かない）
    for c in conn.execute(
        "SELECT m.* FROM relation_candidates rc JOIN messages m ON m.id = rc.message_id "
        "WHERE rc.request_id = ? AND rc.status = 'pending'", (request_id,)):
        found = rules.extract_fields(req["type_code"], c["body"], c["subject"], datetime.fromisoformat(c["received_at"]))
        candidate_fills |= {k for k, v in found.items() if v.value}
        due = found.get("提出希望日時")
        if due and due.value and due.value != req["requested_due"] and proposed_due is None:
            proposed_due, proposed_channel = due.value, c["channel"]
    change_msg = conn.execute(
        "SELECT m.channel FROM request_messages rm JOIN messages m ON m.id = rm.message_id "
        "WHERE rm.request_id = ? AND rm.role = 'change' ORDER BY m.received_at DESC LIMIT 1", (request_id,)).fetchone()

    if req["due_change_status"] == "needs_consult":
        wish, wish_channel = req["requested_due"], (change_msg["channel"] if change_msg else origin["channel"])
    elif proposed_due:
        wish, wish_channel = proposed_due, proposed_channel
    else:
        wish, wish_channel = req["requested_due"], origin["channel"]

    events = [dict(e) for e in conn.execute("SELECT * FROM events WHERE source = ?", (req["source"],))]
    return {
        "req": req, "fields": fields, "origin": origin, "now": now,
        "missing": [n for n, f in fields.items() if f["state"] == "missing" and n not in candidate_fills],
        "wish": wish, "wish_channel": wish_channel, "slots": free_slots(events, now),
    }


def decide_kind(ctx: dict) -> str | None:
    """今、この依頼にどの下書きが必要か。"""
    req = ctx["req"]
    base = req["committed_due"] or req["requested_due"]
    if ctx["wish"] and base and ctx["wish"] < base:
        return "due_adjust"
    if req["status"] == "needs_info" and ctx["missing"]:
        return "confirm"
    if req["type_code"] == "inquiry" and req["status"] == "ready":
        return "answer"
    return None


def basis_for(kind: str, ctx: dict) -> dict:
    req = ctx["req"]
    if kind == "due_adjust":
        return {"committed_due": req["committed_due"], "wish_due": ctx["wish"], "effort": req["effort_minutes"]}
    if kind == "confirm":
        return {"missing": ctx["missing"]}
    return {}


def build(kind: str, ctx: dict) -> dict:
    """テンプレートから下書きを組み立てる。"""
    req, origin, now = ctx["req"], ctx["origin"], ctx["now"]
    to = t.family_name(req["requester_name"])
    me = config.USER_NAME
    channel = ctx["wish_channel"] if kind == "due_adjust" else origin["channel"]
    subject = None if channel == "teams" else "RE: " + (origin["subject"] or req["title"])

    if kind == "due_adjust":
        free = free_minutes_until(ctx["slots"], datetime.fromisoformat(ctx["wish"]))
        meeting = (ctx["fields"].get("会議・用途") or {}).get("value")
        body = t.due_adjust(to, me, meeting, req["committed_due"], ctx["wish"], free, req["effort_minutes"], now)
    elif kind == "confirm":
        body = t.confirm(to, me, req["title"], ctx["missing"])
    elif kind == "answer":
        body = t.answer(to, me, req["title"])
    elif kind == "completion":
        body = t.completion(to, me, req["title"])
    else:
        raise ValueError(f"不明な下書きの種類です: {kind}")
    return {"channel": channel, "to_name": req["requester_name"], "to_email": req["requester_email"],
            "subject": subject, "body": body, "basis": basis_for(kind, ctx)}


def _changes(kind: str, stored: dict, ctx: dict) -> list[dict]:
    """作成時の条件と今の条件を比べ、変わった項目を返す。"""
    current = basis_for(kind, ctx)
    out = []
    for key, old in stored.items():
        new = current.get(key)
        if new != old:
            fmt = (lambda v: "、".join(v) if v else "なし") if key == "missing" else \
                  (lambda v: t.fmt(v, ctx["now"])) if key.endswith("_due") else (lambda v: f"{v}" if v else "未設定")
            out.append({"label": BASIS_LABELS.get(key, key), "old": fmt(old), "new": fmt(new)})
    return out


# ---------------------------------------------------------------- 作成

def _event(conn, draft_id, at, action, note=None):
    conn.execute("INSERT INTO draft_events (draft_id, at, action, note) VALUES (?, ?, ?, ?)",
                 (draft_id, at, action, note))


def _insert(conn, request_id: int, kind: str, d: dict, at: str, actor: str) -> int:
    cur = conn.execute(
        "INSERT INTO drafts (request_id, kind, channel, to_name, to_email, subject, body, generated_body, basis, "
        "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)",
        (request_id, kind, d["channel"], d["to_name"], d["to_email"], d["subject"], d["body"], d["body"],
         json.dumps(d["basis"], ensure_ascii=False), at, at))
    _event(conn, cur.lastrowid, at, "generated")
    add_history(conn, request_id, at, actor, "draft",
                note=f"{t.KIND_LABELS[kind]}の下書きを作成（{'Teams' if d['channel'] == 'teams' else 'Outlook'}向け）")
    return cur.lastrowid


def prepare_drafts(conn: sqlite3.Connection, source: str) -> int:
    """朝の準備：必要な下書きをまだ作っていない依頼にだけ作る。何度呼んでも重複しない。"""
    now = config.now()
    created = 0
    rows = conn.execute(
        f"SELECT id FROM requests WHERE source = ? AND status IN ({','.join('?' * len(OPEN_STATUSES))})",
        (source, *OPEN_STATUSES)).fetchall()
    for r in rows:
        ctx = _context(conn, r["id"], now)
        kind = decide_kind(ctx)
        if kind and not conn.execute("SELECT 1 FROM drafts WHERE request_id = ? AND kind = ?", (r["id"], kind)).fetchone():
            _insert(conn, r["id"], kind, build(kind, ctx), now.isoformat(), "ai")
            created += 1
    conn.commit()
    return created


def generate(conn: sqlite3.Connection, request_id: int, kind: str) -> dict:
    """利用者の操作で作る／作り直す。編集済みの本文は上書きせず、新しい案として別に持つ。"""
    if kind not in t.KIND_LABELS:
        raise ValueError(f"不明な下書きの種類です: {kind}")
    if conn.execute("SELECT 1 FROM requests WHERE id = ?", (request_id,)).fetchone() is None:
        raise LookupError("依頼が見つかりません")
    now = config.now()
    at = now.isoformat()
    ctx = _context(conn, request_id, now)
    new = build(kind, ctx)
    cur = conn.execute("SELECT * FROM drafts WHERE request_id = ? AND kind = ?", (request_id, kind)).fetchone()
    if cur is None:
        draft_id = _insert(conn, request_id, kind, new, at, "user")
    else:
        if cur["status"] == "sent":
            raise ValueError("送信済みの下書きは作り直せません")
        draft_id = cur["id"]
        if cur["is_edited"]:
            # 利用者の編集を守る：本文はそのまま、新しい案だけ更新
            conn.execute("UPDATE drafts SET generated_body = ?, has_new_suggestion = ?, basis = ?, status = "
                         "CASE WHEN status = 'discarded' THEN 'draft' ELSE status END, updated_at = ? WHERE id = ?",
                         (new["body"], int(new["body"] != cur["body"]), json.dumps(new["basis"], ensure_ascii=False),
                          at, draft_id))
        else:
            conn.execute("UPDATE drafts SET body = ?, generated_body = ?, has_new_suggestion = 0, basis = ?, "
                         "channel = ?, subject = ?, status = 'draft', updated_at = ? WHERE id = ?",
                         (new["body"], new["body"], json.dumps(new["basis"], ensure_ascii=False),
                          new["channel"], new["subject"], at, draft_id))
        _event(conn, draft_id, at, "regenerated")
    conn.commit()
    return get_draft(conn, draft_id)


# ---------------------------------------------------------------- 利用者の操作

def _get_row(conn, draft_id: int):
    row = conn.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
    if row is None:
        raise LookupError("下書きが見つかりません")
    return row


def edit(conn, draft_id: int, body: str) -> dict:
    row = _get_row(conn, draft_id)
    if not body or not body.strip():
        raise ValueError("本文が空です")
    if row["status"] == "sent":
        raise ValueError("送信済みの下書きは編集できません")
    at = config.now().isoformat()
    # 保存済みのものを編集したら、もう一度保存が必要（未保存に戻す）
    conn.execute("UPDATE drafts SET body = ?, is_edited = ?, status = CASE WHEN status IN ('saved', 'discarded') "
                 "THEN 'draft' ELSE status END, updated_at = ? WHERE id = ?",
                 (body, int(body != row["generated_body"]), at, draft_id))
    _event(conn, draft_id, at, "edited")
    conn.commit()
    return get_draft(conn, draft_id)


def act(conn, draft_id: int, action: str) -> dict:
    """copy / save / sent / discard / apply-suggestion"""
    row = _get_row(conn, draft_id)
    at = config.now().isoformat()
    rid = row["request_id"]
    if row["status"] == "sent" and action != "copy":
        raise ValueError("送信済みの下書きです")

    if action == "copy":
        _event(conn, draft_id, at, "copied")
    elif action == "save":
        if row["channel"] != "outlook":
            raise ValueError("Teams には下書きを保存できません。コピーして Teams に貼り付けてください")
        conn.execute("UPDATE drafts SET status = 'saved', updated_at = ? WHERE id = ?", (at, draft_id))
        _event(conn, draft_id, at, "saved")
        add_history(conn, rid, at, "user", "draft_saved",
                    note=f"{t.KIND_LABELS[row['kind']]}をOutlookの下書きに保存（デモ内）。まだ送信していません")
    elif action == "sent":
        _record_sent(conn, row, at)
    elif action == "discard":
        conn.execute("UPDATE drafts SET status = 'discarded', updated_at = ? WHERE id = ?", (at, draft_id))
        _event(conn, draft_id, at, "discarded")
    elif action == "apply-suggestion":
        if not row["has_new_suggestion"]:
            raise ValueError("新しい案はありません")
        conn.execute("UPDATE drafts SET body = generated_body, is_edited = 0, has_new_suggestion = 0, "
                     "updated_at = ? WHERE id = ?", (at, draft_id))
        _event(conn, draft_id, at, "suggestion_applied")
    else:
        raise ValueError(f"不明な操作です: {action}")
    conn.commit()
    return get_draft(conn, draft_id)


def _record_sent(conn, row, at: str) -> None:
    """利用者が送信したことを記録する。デモでは実際には送らず、送信済みの記録だけを残す。"""
    req = conn.execute("SELECT * FROM requests WHERE id = ?", (row["request_id"],)).fetchone()
    cur = conn.execute(
        "INSERT INTO messages (source, channel, external_id, conversation_id, direction, sender_email, sender_name, "
        "recipients, subject, body, received_at, ingested_at) VALUES (?, ?, ?, NULL, 'sent', ?, ?, ?, ?, ?, ?, ?)",
        (req["source"], row["channel"], f"draft-{row['id']}-sent", config.USER_EMAIL, config.USER_NAME,
         json.dumps([row["to_email"]], ensure_ascii=False), row["subject"], row["body"], at, at))
    message_id = cur.lastrowid
    conn.execute("INSERT INTO message_classes (message_id, category, reason, request_id) VALUES (?, 'sent', ?, ?)",
                 (message_id, "利用者が下書きから送信", req["id"]))
    _link(conn, req["id"], message_id, "question", "user")
    conn.execute("UPDATE drafts SET status = 'sent', updated_at = ? WHERE id = ?", (at, row["id"]))
    _event(conn, row["id"], at, "sent", note="edited" if row["is_edited"] else "as_is")
    add_history(conn, req["id"], at, "user", "question_sent" if row["kind"] in ("confirm", "due_adjust") else "reply_sent",
                message_id=message_id, note=f"{t.KIND_LABELS[row['kind']]}を送信（{'Teams' if row['channel'] == 'teams' else 'Outlook'}）")
    if row["kind"] == "confirm" and req["status"] == "needs_info":
        _set_status(conn, req["id"], "waiting_reply", at, "user", note="確認を送信した")


# ---------------------------------------------------------------- 参照

def get_draft(conn, draft_id: int) -> dict:
    row = dict(_get_row(conn, draft_id))
    now = config.now()
    ctx = _context(conn, row["request_id"], now)
    stored = json.loads(row.pop("basis"))
    row["kind_label"] = t.KIND_LABELS[row["kind"]]
    row["changes"] = [] if row["status"] in ("sent", "discarded") else _changes(row["kind"], stored, ctx)
    row["needs_review"] = bool(row["changes"])
    row["has_placeholder"] = t.PLACEHOLDER in row["body"]
    row["generator"] = "デモ：テンプレートによる下書き（生成AIは未使用）"
    return row


def list_drafts(conn, request_id: int) -> list[dict]:
    ids = [r["id"] for r in conn.execute("SELECT id FROM drafts WHERE request_id = ? ORDER BY id", (request_id,))]
    return [get_draft(conn, i) for i in ids]

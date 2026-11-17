"""会議資料のたたき台：参照の許可・作成・条件変化の検知・ダウンロード。

守るルール
  - 利用者が依頼ごとに参照を許可したファイルだけを読む（許可していなければ数値は「要確認」）。
  - 読めるのはデモ用フォルダの中のファイルだけ（パスの指定で外のファイルを読ませない）。
  - 作成時の条件（許可ファイル・対象期間・確定期限）を記録し、変わったら知らせる。
"""
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from app import config
from app.documents import deck, sales
from app.drafts.service import _context as draft_context
from app.drafts.templates import fmt
from app.intake.service import add_history

FILES_DIR = config.DEMO_DATA_DIR / "files"
OPEN_STATUSES = ("needs_info", "waiting_reply", "ready", "in_progress")
BASIS_LABELS = {"files": "参照するファイル", "month": "対象期間", "committed_due": "確定期限"}


# ---------------------------------------------------------------- ファイルと参照の許可

def available_files() -> list[str]:
    return sorted(p.name for p in FILES_DIR.glob("*.xlsx"))


def _resolve(name: str) -> Path:
    """一覧にある名前だけを受け付ける。『../』などで外のファイルを指定させない。"""
    if name not in available_files():
        raise LookupError(f"ファイルが見つかりません：{name}")
    return FILES_DIR / name


def allowed_files(conn, request_id: int) -> list[str]:
    return [r["file_name"] for r in conn.execute(
        "SELECT file_name FROM file_permissions WHERE request_id = ? ORDER BY file_name", (request_id,))]


def set_permission(conn, request_id: int, file_name: str, allowed: bool, at: str | None = None) -> list[str]:
    if conn.execute("SELECT 1 FROM requests WHERE id = ?", (request_id,)).fetchone() is None:
        raise LookupError("依頼が見つかりません")
    _resolve(file_name)
    at = at or config.now().isoformat()
    if allowed:
        conn.execute("INSERT INTO file_permissions (request_id, file_name, allowed_at) VALUES (?, ?, ?) "
                     "ON CONFLICT DO NOTHING", (request_id, file_name, at))
        add_history(conn, request_id, at, "user", "decision", note=f"『{file_name}』の参照を許可")
    else:
        conn.execute("DELETE FROM file_permissions WHERE request_id = ? AND file_name = ?", (request_id, file_name))
        add_history(conn, request_id, at, "user", "decision", note=f"『{file_name}』の参照の許可を取り消し")
    conn.commit()
    return allowed_files(conn, request_id)


# ---------------------------------------------------------------- 条件の読み取り

def _params(conn, request_id: int) -> dict:
    now = config.now()
    ctx = draft_context(conn, request_id, now)
    req, origin = ctx["req"], ctx["origin"]
    body = origin["body"]
    # 「10月の売上」のように、依頼文から対象月を読む（年は依頼を受けた年）
    m = re.search(r"(\d{1,2})月(?:の|分の)?売上", body)
    month = month_evidence = None
    if m:
        received = datetime.fromisoformat(origin["received_at"])
        month = f"{received.year}-{int(m[1]):02d}"
        line = next((ln for ln in body.splitlines() if m[0] in ln), m[0])
        month_evidence = f"依頼文「{line.strip('・ ')}」"
    files = allowed_files(conn, request_id)
    committed = req["committed_due"]
    speed = bool(ctx["wish"] and committed and ctx["wish"] < committed)
    return {
        "req": req, "now": now, "month": month, "month_evidence": month_evidence, "files": files,
        "meeting": (ctx["fields"].get("会議・用途") or {}).get("value"),
        "speed": speed, "committed_label": fmt(committed, now) if committed else None,
        "basis": {"files": files, "month": month, "committed_due": committed},
    }


def _build(p: dict) -> dict:
    file_name = p["files"][0] if p["files"] else None
    agg = error = None
    if file_name and p["month"]:
        try:
            agg = sales.aggregate_by_dept(sales.read_rows(_resolve(file_name)), p["month"])
        except (ValueError, OSError) as e:
            error = str(e)
    return deck.build_content(
        meeting=p["meeting"], month=p["month"], month_evidence=p["month_evidence"], file_name=file_name,
        agg=agg, error=error, speed=p["speed"], committed_label=p["committed_label"],
        aggregated_at=f"{p['now']:%m/%d %H:%M}（デモ時刻）")


# ---------------------------------------------------------------- 作成・作り直し

def generate(conn, request_id: int, actor: str = "user") -> dict:
    req = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    if req is None:
        raise LookupError("依頼が見つかりません")
    if req["type_code"] != "document":
        raise ValueError("資料作成の依頼ではありません")
    p = _params(conn, request_id)
    content = _build(p)
    at = p["now"].isoformat()
    cur = conn.execute("SELECT * FROM documents WHERE request_id = ?", (request_id,)).fetchone()
    if cur is None:
        c = conn.execute("INSERT INTO documents (request_id, title, content, basis, created_at, updated_at) "
                         "VALUES (?, ?, ?, ?, ?, ?)",
                         (request_id, content["title"], json.dumps(content, ensure_ascii=False),
                          json.dumps(p["basis"], ensure_ascii=False), at, at))
        doc_id, action = c.lastrowid, "generated"
    else:
        doc_id, action = cur["id"], "regenerated"
        conn.execute("UPDATE documents SET title = ?, content = ?, basis = ?, version = version + 1, updated_at = ? "
                     "WHERE id = ?", (content["title"], json.dumps(content, ensure_ascii=False),
                                      json.dumps(p["basis"], ensure_ascii=False), at, doc_id))
    conn.execute("INSERT INTO document_events (document_id, at, action) VALUES (?, ?, ?)", (doc_id, at, action))
    note = "要確認あり（元データ不足）" if not content["complete"] else f"『{p['files'][0]}』を集計"
    add_history(conn, request_id, at, actor, "document",
                note=f"会議資料の{content['label']}（3枚）を{'作成' if action == 'generated' else '作り直し'}：{note}")
    conn.commit()
    return get_document(conn, request_id)


def prepare_documents(conn, source: str) -> int:
    """朝の準備：参照を許可したファイルがある資料作成の依頼に、たたき台を用意する（既にあれば作らない）。"""
    rows = conn.execute(
        f"SELECT r.id FROM requests r WHERE r.source = ? AND r.type_code = 'document' "
        f"AND r.status IN ({','.join('?' * len(OPEN_STATUSES))}) "
        "AND EXISTS (SELECT 1 FROM file_permissions f WHERE f.request_id = r.id) "
        "AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.request_id = r.id)",
        (source, *OPEN_STATUSES)).fetchall()
    for r in rows:
        generate(conn, r["id"], actor="ai")
    return len(rows)


# ---------------------------------------------------------------- 参照・ダウンロード

def get_document(conn, request_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM documents WHERE request_id = ?", (request_id,)).fetchone()
    if row is None:
        return None
    p = _params(conn, request_id)
    stored = json.loads(row["basis"])
    changes = []
    for key, old in stored.items():
        new = p["basis"].get(key)
        if new != old:
            show = (lambda v: "、".join(v) if v else "なし") if key == "files" else \
                   (lambda v: fmt(v, p["now"])) if key == "committed_due" else (lambda v: v or "未設定")
            changes.append({"label": BASIS_LABELS[key], "old": show(old), "new": show(new)})
    return {"id": row["id"], "request_id": request_id, "title": row["title"], "version": row["version"],
            "content": json.loads(row["content"]), "changes": changes, "needs_review": bool(changes),
            "generator": "デモ：固定ルールで集計・構成（生成AIは未使用）", "updated_at": row["updated_at"]}


def download(conn, document_id: int) -> tuple[str, bytes]:
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    if row is None:
        raise LookupError("資料が見つかりません")
    content = json.loads(row["content"])
    conn.execute("INSERT INTO document_events (document_id, at, action) VALUES (?, ?, 'downloaded')",
                 (document_id, config.now().isoformat()))
    conn.commit()
    safe = re.sub(r"[\\/:*?\"<>|【】（）\s]", "", content["title"])
    return f"{safe}_v{row['version']}.pptx", deck.render_pptx(content)


def files_view(conn, request_id: int) -> list[dict]:
    allowed = set(allowed_files(conn, request_id))
    return [{"name": n, "allowed": n in allowed} for n in available_files()]

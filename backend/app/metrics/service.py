"""改善レポート：イベントの記録から指標を計算する。

値の出どころを必ず区別する。
  sample   … デモのサンプル値（架空の過去データ。導入前後の比較の例）
  measured … デモ中の実測値（このデモのデータと、画面操作の記録から集計）
  real     … 実利用での計測値（実連携後に計測。現在は未計測）
比較には、期間・件数・集計条件を一緒に返す。
"""
import json
import sqlite3
import statistics
from datetime import datetime

from app import config

LABELS = {
    "sample": "サンプル値（架空の過去データ）",
    "measured": "デモ中の実測値",
    "real": "実利用の計測値",
}
USAGE_KINDS = ("home_open", "first_action")


def record_usage(conn: sqlite3.Connection, session_id: str, kind: str, request_id: int | None = None) -> None:
    if kind not in USAGE_KINDS:
        raise ValueError(f"不明な記録の種類です: {kind}")
    if not session_id or len(session_id) > 64:
        raise ValueError("session_id が不正です")
    conn.execute("INSERT INTO usage_events (session_id, kind, at, request_id) VALUES (?, ?, ?, ?)",
                 (session_id, kind, datetime.now(config.JST).isoformat(), request_id))
    conn.commit()


# ---------------------------------------------------------------- 朝の段取り時間

def morning_planning(conn) -> dict:
    """セッションごとに、最初の home_open から最初の first_action までの秒数。"""
    rows = conn.execute("SELECT session_id, kind, at FROM usage_events ORDER BY at").fetchall()
    first: dict[str, dict[str, str]] = {}
    for r in rows:
        first.setdefault(r["session_id"], {}).setdefault(r["kind"], r["at"])
    secs = []
    for s in first.values():
        if "home_open" in s and "first_action" in s and s["first_action"] >= s["home_open"]:
            secs.append((datetime.fromisoformat(s["first_action"]) - datetime.fromisoformat(s["home_open"])).total_seconds())
    measured = None
    if secs:
        measured = {"count": len(secs), "latest_seconds": round(secs[-1]), "median_seconds": round(statistics.median(secs)),
                    "condition": "「今日やること」を開いてから、最初の操作（返信案を開く・判断・並べ替えなど）をするまで"}
    return {"measured": measured}


# ---------------------------------------------------------------- 確認の往復と、着手可能までの時間

def requests_flow(conn, source: str) -> dict:
    types = {r["code"]: r["name"] for r in conn.execute("SELECT code, name FROM request_types")}
    rows = []
    for r in conn.execute("SELECT * FROM requests WHERE source = ? ORDER BY id", (source,)):
        trips = conn.execute("SELECT COUNT(*) AS n FROM request_history WHERE request_id = ? AND kind = 'question_sent'",
                             (r["id"],)).fetchone()["n"]
        ready = conn.execute("SELECT at FROM request_history WHERE request_id = ? AND kind = 'status' AND new_value = '着手可能' "
                             "ORDER BY at LIMIT 1", (r["id"],)).fetchone()
        missing_first = conn.execute("SELECT COUNT(*) AS n FROM request_fields WHERE request_id = ? AND missing_initially = 1",
                                     (r["id"],)).fetchone()["n"]
        hours = None
        if ready:
            hours = round((datetime.fromisoformat(ready["at"]) - datetime.fromisoformat(r["created_at"])).total_seconds() / 3600, 1)
        rows.append({"id": r["id"], "title": r["title"], "type": types.get(r["type_code"], r["type_code"]),
                     "round_trips": trips, "hours_to_ready": hours, "complete_first": missing_first == 0,
                     "received_at": r["created_at"]})
    by_type = []
    for name in sorted({x["type"] for x in rows}):
        xs = [x for x in rows if x["type"] == name]
        ready = [x["hours_to_ready"] for x in xs if x["hours_to_ready"] is not None]
        by_type.append({
            "type": name, "count": len(xs),
            "complete_first_rate": round(sum(x["complete_first"] for x in xs) / len(xs) * 100),
            "avg_round_trips": round(sum(x["round_trips"] for x in xs) / len(xs), 1),
            "avg_hours_to_ready": round(sum(ready) / len(ready), 1) if ready else None,
            "ready_count": len(ready),
        })
    period = None
    if rows:
        period = f"{min(x['received_at'] for x in rows)[:10]}〜{max(x['received_at'] for x in rows)[:10]}"
    return {"rows": rows, "by_type": by_type, "period": period,
            "condition": "依頼を受けてから、着手に必要な項目がそろう（着手可能になる）まで。往復＝確認を送った回数"}


# ---------------------------------------------------------------- 下書きの利用状況

def draft_usage(conn, source: str) -> dict:
    out = {"as_is": 0, "edited": 0, "unused": 0, "pending": 0}
    for d in conn.execute("SELECT d.* FROM drafts d JOIN requests r ON r.id = d.request_id WHERE r.source = ?", (source,)):
        used = d["status"] in ("saved", "sent") or conn.execute(
            "SELECT 1 FROM draft_events WHERE draft_id = ? AND action = 'copied'", (d["id"],)).fetchone() is not None
        if d["status"] == "discarded":
            out["unused"] += 1
        elif used:
            out["edited" if d["is_edited"] else "as_is"] += 1
        else:
            out["pending"] += 1
    docs = conn.execute("SELECT COUNT(*) AS n FROM document_events e JOIN documents d ON d.id = e.document_id "
                        "JOIN requests r ON r.id = d.request_id WHERE r.source = ? AND e.action = 'downloaded'",
                        (source,)).fetchone()["n"]
    return {"drafts": out, "total": sum(out.values()), "document_downloads": docs,
            "condition": "使った＝保存・送信の記録・コピーのいずれか。編集して使った＝利用者が本文を書き換えてから使った"}


# ---------------------------------------------------------------- よく抜ける項目

def missing_fields(conn, source: str) -> list[dict]:
    result = []
    for t in conn.execute("SELECT * FROM request_types ORDER BY code"):
        reqs = [r["id"] for r in conn.execute("SELECT id FROM requests WHERE source = ? AND type_code = ?", (source, t["code"]))]
        if not reqs:
            continue
        counts = []
        for name in json.loads(t["required_fields"]):
            n = conn.execute(
                f"SELECT COUNT(*) AS n FROM request_fields WHERE name = ? AND missing_initially = 1 "
                f"AND request_id IN ({','.join('?' * len(reqs))})", (name, *reqs)).fetchone()["n"]
            if n:
                counts.append({"field": name, "count": n})
        counts.sort(key=lambda x: -x["count"])
        hint = None
        if counts and counts[0]["count"] / len(reqs) >= 0.5:
            hint = (f"{t['name']}の依頼の{counts[0]['count']}/{len(reqs)}件で『{counts[0]['field']}』が抜けています。"
                    f"受付テンプレートに『{counts[0]['field']}』の欄を足すと、初回で情報がそろいやすくなります。")
        result.append({"type": t["name"], "count": len(reqs), "fields": counts, "hint": hint})
    return result


def build_report(conn: sqlite3.Connection, source: str) -> dict:
    with open(config.DEMO_DATA_DIR / "metrics_sample.json", encoding="utf-8") as f:
        sample = json.load(f)
    return {
        "labels": LABELS,
        "morning": {**morning_planning(conn), "sample": sample["morning_planning"], "real": None},
        "flow": requests_flow(conn, source),
        "drafts": draft_usage(conn, source),
        "missing": missing_fields(conn, source),
        "template_change": sample["template_change"],
    }

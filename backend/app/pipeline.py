"""取り込み → 依頼の処理 を一続きで実行する。

デモの初回だけは、次の順で「前日までの状態」を再現してから夜間の連絡を処理する。
  1. 前回確認（11/17 18:30）までのメッセージを処理する
  2. 前日に利用者が決めた確定期限・作業枠を適用する（carryover.json）
  3. それ以降に届いた夜間のメッセージを処理する
"""
import json
import sqlite3

from app import config
from app.ingest.service import ingest
from app.intake.service import apply_carryover, process_messages


def run_pipeline(conn: sqlite3.Connection, source) -> dict:
    result = ingest(conn, source)
    processed: dict[str, int] = {}

    if source.name == "demo" and not _flag(conn, "carryover_applied"):
        before = process_messages(conn, source.name, until=config.DEMO_LAST_CHECKED.isoformat())
        with open(config.DEMO_DATA_DIR / "carryover.json", encoding="utf-8") as f:
            apply_carryover(conn, json.load(f)["decisions"], source.name)
        _set_flag(conn, "carryover_applied")
        processed = _merge(processed, before)

    processed = _merge(processed, process_messages(conn, source.name))
    result["processed"] = processed
    return result


def _flag(conn, key: str) -> bool:
    return conn.execute("SELECT 1 FROM app_meta WHERE key = ?", (key,)).fetchone() is not None


def _set_flag(conn, key: str) -> None:
    conn.execute("INSERT INTO app_meta (key, value) VALUES (?, '1') ON CONFLICT DO NOTHING", (key,))
    conn.commit()


def _merge(a: dict, b: dict) -> dict:
    return {k: a.get(k, 0) + b.get(k, 0) for k in set(a) | set(b)}

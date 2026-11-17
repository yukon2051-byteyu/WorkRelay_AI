"""取り込み → 依頼の処理 を一続きで実行する。

デモの初回だけは、次の順で「前日までの状態」を再現してから夜間の連絡を処理する。
  1. 前回確認（11/17 18:30）までのメッセージを処理する
  2. 前日に利用者が決めた確定期限・作業枠を適用する（carryover.json）
  3. それ以降に届いた夜間のメッセージを処理する
"""
import json
import sqlite3

from app import config
from app.documents import service as documents
from app.drafts.service import prepare_drafts
from app.ingest.service import ingest
from app.intake.service import apply_carryover, process_messages


def run_pipeline(conn: sqlite3.Connection, source) -> dict:
    result = ingest(conn, source)
    processed: dict[str, int] = {}

    if source.name == "demo" and not _flag(conn, "carryover_applied"):
        before = process_messages(conn, source.name, until=config.DEMO_LAST_CHECKED.isoformat())
        with open(config.DEMO_DATA_DIR / "carryover.json", encoding="utf-8") as f:
            decisions = json.load(f)["decisions"]
        apply_carryover(conn, decisions, source.name)
        # 前日に利用者が参照を許可したファイル（売上Excel）
        for d in decisions:
            for name in d.get("allowed_files", []):
                rid = conn.execute(
                    "SELECT r.id FROM requests r JOIN messages m ON m.id = r.origin_message_id "
                    "WHERE m.source = ? AND m.external_id = ?", (source.name, d["origin_external_id"])).fetchone()["id"]
                documents.set_permission(conn, rid, name, True, at=d["at"])
        _set_flag(conn, "carryover_applied")
        processed = _merge(processed, before)

    processed = _merge(processed, process_messages(conn, source.name))
    result["processed"] = processed
    # 朝の準備：必要な返信・確認文の下書きを用意する（作るだけ。保存・送信はしない）
    result["drafts_created"] = prepare_drafts(conn, source.name)
    # 参照を許可した売上データがある資料依頼には、会議資料のたたき台を用意する
    result["documents_created"] = documents.prepare_documents(conn, source.name)
    return result


def _flag(conn, key: str) -> bool:
    return conn.execute("SELECT 1 FROM app_meta WHERE key = ?", (key,)).fetchone() is not None


def _set_flag(conn, key: str) -> None:
    conn.execute("INSERT INTO app_meta (key, value) VALUES (?, '1') ON CONFLICT DO NOTHING", (key,))
    conn.commit()


def _merge(a: dict, b: dict) -> dict:
    return {k: a.get(k, 0) + b.get(k, 0) for k in set(a) | set(b)}

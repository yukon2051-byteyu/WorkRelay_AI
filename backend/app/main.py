"""WorkRelay AI バックエンドの入口（API の一覧）。"""
from collections.abc import Iterator
import sqlite3

from fastapi import Depends, FastAPI, HTTPException

from app import config
from app.db import connect
from app.ingest.service import ingest
from app.sources.demo import DemoSource

app = FastAPI(title="WorkRelay AI")


def get_conn() -> Iterator[sqlite3.Connection]:
    """リクエストごとに DB へ接続し、終わったら閉じる。テストでは差し替える。"""
    conn = connect(config.db_path())
    try:
        yield conn
    finally:
        conn.close()


def get_source():
    """現在のモードに応じた取り込み元を返す。"""
    if config.DATA_MODE == "demo":
        return DemoSource()
    # 実連携はステップ9で実装する。それまでは「未接続」として扱う
    raise HTTPException(status_code=503, detail="Microsoft 365 は未接続です")


@app.get("/api/health")
def health() -> dict:
    """死活確認用。画面からここを呼び、サーバーとつながっているかを確かめる。"""
    return {"status": "ok", "mode": config.DATA_MODE}


@app.post("/api/ingest")
def run_ingest(conn=Depends(get_conn), source=Depends(get_source)) -> dict:
    """取り込み元からメール・Teams・予定を取り込む。何度実行しても重複しない。"""
    return ingest(conn, source)


@app.get("/api/messages")
def list_messages(new_only: bool = False, conn=Depends(get_conn)) -> list[dict]:
    """取り込んだメッセージの一覧。new_only=true なら前回確認以降の受信だけ。"""
    sql = "SELECT * FROM messages WHERE source = ?"
    params: list = [config.DATA_MODE]
    if new_only:
        sql += " AND direction = 'received' AND received_at > ?"
        params.append(config.DEMO_LAST_CHECKED.isoformat())
    sql += " ORDER BY received_at"
    return [dict(r) for r in conn.execute(sql, params)]


@app.get("/api/events")
def list_events(conn=Depends(get_conn)) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM events WHERE source = ? ORDER BY start_at", [config.DATA_MODE]
    )
    return [dict(r) for r in rows]


@app.post("/api/demo/reset")
def reset_demo(conn=Depends(get_conn)) -> dict:
    """デモを最初の状態に戻す（全データ削除）。デモモードでのみ使える。"""
    if config.DATA_MODE != "demo":
        raise HTTPException(status_code=403, detail="デモモード以外では使えません")
    for table in ("messages", "events", "ingest_runs"):
        conn.execute(f"DELETE FROM {table}")
    conn.commit()
    return {"status": "reset"}

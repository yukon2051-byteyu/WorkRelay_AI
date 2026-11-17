"""DB の接続と構成変更（マイグレーション）のテスト。"""
import sqlite3
import threading

from app.db import connect


def test_connection_can_be_used_from_another_thread(tmp_path):
    """接続を作ったスレッドと別のスレッドから使っても失敗しない（同時アクセス時の500エラーの再発防止）。"""
    conn = connect(tmp_path / "t.db")
    errors = []

    def use():
        try:
            conn.execute("SELECT COUNT(*) FROM messages").fetchone()
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    t = threading.Thread(target=use)
    t.start()
    t.join()
    assert errors == []


def test_old_db_file_gets_new_columns(tmp_path):
    """ステップ2時点の古い DB ファイルでも、起動時に足りない列が追加され、データは残る。"""
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.execute("""CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
                   external_id TEXT NOT NULL, title TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
                   kind TEXT NOT NULL, ingested_at TEXT NOT NULL, UNIQUE (source, external_id))""")
    old.execute("INSERT INTO events (source, external_id, title, start_at, end_at, kind, ingested_at) "
                "VALUES ('demo', 'e1', '朝会', 'a', 'b', 'meeting', 'c')")
    old.commit()
    old.close()

    conn = connect(path)
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(events)")}
    assert "request_id" in cols
    assert conn.execute("SELECT title FROM events").fetchone()["title"] == "朝会"

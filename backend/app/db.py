"""SQLite への接続と、テーブルの作成。

ORM（データベースを Python のクラスとして扱う仕組み）は使わず、
標準ライブラリの sqlite3 と SQL 文で書く。中で何が起きているかを追いやすくするため。
"""
import sqlite3
from pathlib import Path

SCHEMA = """
-- 取り込んだメール・Teamsメッセージ（元の連絡そのもの）
CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT NOT NULL,   -- 'demo' / 'm365'
    channel         TEXT NOT NULL,   -- 'outlook' / 'teams'
    external_id     TEXT NOT NULL,   -- 取り込み元での ID（重複判定に使う）
    conversation_id TEXT,            -- メールのスレッド / Teams のチャット ID
    direction       TEXT NOT NULL,   -- 'received'（受信） / 'sent'（自分が送信）
    sender_email    TEXT,
    sender_name     TEXT,
    recipients      TEXT,            -- JSON 配列
    subject         TEXT,
    body            TEXT NOT NULL,
    received_at     TEXT NOT NULL,   -- ISO 8601（+09:00 付き）
    ingested_at     TEXT NOT NULL,
    UNIQUE (source, channel, external_id)   -- 同じメッセージは2回入らない
);

-- 予定表の予定
CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    title        TEXT NOT NULL,
    start_at     TEXT NOT NULL,
    end_at       TEXT NOT NULL,
    kind         TEXT NOT NULL,      -- 'meeting'（会議） / 'work'（作業枠）
    ingested_at  TEXT NOT NULL,
    UNIQUE (source, external_id)
);

-- 取り込みの実行記録
CREATE TABLE IF NOT EXISTS ingest_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source           TEXT NOT NULL,
    run_at           TEXT NOT NULL,
    new_messages     INTEGER NOT NULL,
    skipped_messages INTEGER NOT NULL,
    new_events       INTEGER NOT NULL,
    skipped_events   INTEGER NOT NULL
);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row  # 列名で値を取り出せるようにする
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn

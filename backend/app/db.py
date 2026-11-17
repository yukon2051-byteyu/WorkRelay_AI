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
    request_id   INTEGER,            -- 作業枠なら、どの依頼のための枠か
    UNIQUE (source, external_id)
);

-- 依頼種別と「着手に必要な項目」（画面から変更できる）
CREATE TABLE IF NOT EXISTS request_types (
    code            TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    required_fields TEXT NOT NULL    -- JSON 配列
);

-- 依頼（1件の仕事）
CREATE TABLE IF NOT EXISTS requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source            TEXT NOT NULL,
    type_code         TEXT NOT NULL REFERENCES request_types(code),
    title             TEXT NOT NULL,
    requester_email   TEXT,
    requester_name    TEXT,
    requested_due     TEXT,          -- 依頼者の希望期限
    committed_due     TEXT,          -- 担当者が引き受けた確定期限
    due_change_status TEXT,          -- 'needs_consult'（変更の相談が必要）など
    status            TEXT NOT NULL, -- needs_info / waiting_reply / ready / in_progress / done
    effort_minutes    INTEGER,       -- 必要な作業時間（NULL = 未見積もり）
    origin_message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

-- 依頼の項目（対象期間・対象部門など）。確定情報と推測を区別して持つ
CREATE TABLE IF NOT EXISTS request_fields (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id          INTEGER NOT NULL REFERENCES requests(id),
    name                TEXT NOT NULL,
    value               TEXT,
    state               TEXT NOT NULL,  -- filled（記入済み） / missing（不足） / deferred（回答保留）
    confidence          TEXT,           -- confirmed（明記） / inferred（推測）
    evidence_message_id INTEGER REFERENCES messages(id),
    evidence_text       TEXT,
    missing_initially   INTEGER NOT NULL DEFAULT 0,  -- 初回の依頼で抜けていたか（効果測定用）
    UNIQUE (request_id, name)
);

-- 依頼と元メッセージの対応（根拠をたどるため）
CREATE TABLE IF NOT EXISTS request_messages (
    request_id INTEGER NOT NULL REFERENCES requests(id),
    message_id INTEGER NOT NULL REFERENCES messages(id),
    role       TEXT NOT NULL,     -- origin / answer / change / question / related
    linked_by  TEXT NOT NULL,     -- thread（同じスレッド） / user（利用者が判断）
    PRIMARY KEY (request_id, message_id)
);

-- メッセージの分類結果。ここに行があるメッセージは「処理済み」
CREATE TABLE IF NOT EXISTS message_classes (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id),
    category   TEXT NOT NULL,     -- new_request / answer / change / candidate / no_action / suspicious / sent
    reason     TEXT NOT NULL,
    request_id INTEGER REFERENCES requests(id)
);

-- 別チャネルから届いた「同じ依頼かもしれない」候補。利用者が判断する
CREATE TABLE IF NOT EXISTS relation_candidates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id),
    request_id INTEGER NOT NULL REFERENCES requests(id),
    reasons    TEXT NOT NULL,     -- JSON 配列（根拠）
    status     TEXT NOT NULL,     -- pending / accepted / rejected
    decided_at TEXT,
    UNIQUE (message_id, request_id)
);

-- アプリの状態フラグ（デモの持ち越しを適用済みか など）
CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 変更履歴（期限・項目・状態・担当者の判断）
CREATE TABLE IF NOT EXISTS request_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    at         TEXT NOT NULL,
    actor      TEXT NOT NULL,     -- ai / user / system
    kind       TEXT NOT NULL,     -- received / field / status / due / link / decision / question_sent
    field      TEXT,
    old_value  TEXT,
    new_value  TEXT,
    message_id INTEGER REFERENCES messages(id),
    note       TEXT
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


# 削除するときの順番（参照される側を後に消す）
ALL_TABLES = [
    "request_history", "relation_candidates", "message_classes", "request_messages",
    "request_fields", "requests", "request_types", "events", "messages", "ingest_runs", "app_meta",
]


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row  # 列名で値を取り出せるようにする
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn

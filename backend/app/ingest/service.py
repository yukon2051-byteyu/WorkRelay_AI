"""取り込み処理の本体。どの取り込み元でも、この関数を通して DB に保存する。

重複防止の仕組み：
  messages テーブルに UNIQUE (source, channel, external_id) を付けている。
  INSERT ... ON CONFLICT DO NOTHING で「すでにあれば何もしない」ので、
  同じデータを何回取り込んでも件数は増えない。
"""
import sqlite3

from app.config import now
from app.ingest.normalize import normalize_event, normalize_mail, normalize_teams
from app.sources.base import Source


def ingest(conn: sqlite3.Connection, source: Source) -> dict:
    ingested_at = now().isoformat()

    messages = [normalize_mail(m) for m in source.fetch_mail()]
    messages += [normalize_teams(m) for m in source.fetch_teams_messages()]
    events = [normalize_event(e) for e in source.fetch_events()]

    new_messages = 0
    for m in messages:
        cur = conn.execute(
            """
            INSERT INTO messages (source, channel, external_id, conversation_id, direction,
                                  sender_email, sender_name, recipients, subject, body,
                                  received_at, ingested_at)
            VALUES (:source, :channel, :external_id, :conversation_id, :direction,
                    :sender_email, :sender_name, :recipients, :subject, :body,
                    :received_at, :ingested_at)
            ON CONFLICT (source, channel, external_id) DO NOTHING
            """,
            {**m, "source": source.name, "ingested_at": ingested_at},
        )
        new_messages += cur.rowcount  # 追加されたら 1、重複なら 0

    new_events = 0
    for e in events:
        cur = conn.execute(
            """
            INSERT INTO events (source, external_id, title, start_at, end_at, kind, ingested_at)
            VALUES (:source, :external_id, :title, :start_at, :end_at, :kind, :ingested_at)
            ON CONFLICT (source, external_id) DO NOTHING
            """,
            {**e, "source": source.name, "ingested_at": ingested_at},
        )
        new_events += cur.rowcount

    result = {
        "source": source.name,
        "new_messages": new_messages,
        "skipped_messages": len(messages) - new_messages,
        "new_events": new_events,
        "skipped_events": len(events) - new_events,
    }
    conn.execute(
        """
        INSERT INTO ingest_runs (source, run_at, new_messages, skipped_messages,
                                 new_events, skipped_events)
        VALUES (:source, :run_at, :new_messages, :skipped_messages,
                :new_events, :skipped_events)
        """,
        {**result, "run_at": ingested_at},
    )
    conn.commit()
    return result

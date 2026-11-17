"""ステップ2：取り込みのテスト。"""
from app import config
from app.ingest.normalize import normalize_event, normalize_teams


def test_ingest_demo_counts(client):
    """架空データが仕様どおりの件数で入る。"""
    res = client.post("/api/ingest")
    assert res.status_code == 200
    body = res.json()
    # メール17通（前日分5通＋夜間12通）＋ Teams 4件
    assert body["new_messages"] == 21
    assert body["new_events"] == 5

    new = client.get("/api/messages", params={"new_only": True}).json()
    mails = [m for m in new if m["channel"] == "outlook"]
    teams = [m for m in new if m["channel"] == "teams"]
    assert len(mails) == 12  # 夜間メール12通
    assert len(teams) == 4


def test_reingest_does_not_duplicate(client):
    """同じデータを再取り込みしても、件数が増えない（完了条件）。"""
    client.post("/api/ingest")
    second = client.post("/api/ingest").json()
    assert second["new_messages"] == 0
    assert second["skipped_messages"] == 21
    assert second["new_events"] == 0

    assert len(client.get("/api/messages").json()) == 21
    assert len(client.get("/api/events").json()) == 5


def test_sent_items_are_marked_as_sent(client):
    client.post("/api/ingest")
    msgs = client.get("/api/messages").json()
    sent = [m for m in msgs if m["direction"] == "sent"]
    assert {m["external_id"] for m in sent} == {"mail-y02-sent", "mail-y03-sent"}


def test_morning_meetings_and_existing_work_slot(client):
    client.post("/api/ingest")
    events = client.get("/api/events").json()
    morning = [e for e in events if e["kind"] == "meeting" and e["start_at"] < "2026-11-18T12:00"]
    assert len(morning) == 2  # 午前中の会議2件
    work = [e for e in events if e["kind"] == "work"]
    assert len(work) == 1 and work[0]["start_at"] == "2026-11-18T13:30:00+09:00"


def test_teams_html_is_converted_to_text():
    raw = {
        "id": "x", "chatId": "c", "createdDateTime": "2026-11-17T12:40:00Z",
        "from": {"user": {"displayName": "架空 太郎", "email": "taro@example.com"}},
        "body": {"contentType": "html", "content": "<p>今日<b>11時</b>まで</p><p>&amp;よろしく</p>"},
    }
    m = normalize_teams(raw)
    assert m["body"] == "今日11時まで\n&よろしく"
    # UTC(Z) の日時は日本時間に変換される
    assert m["received_at"] == "2026-11-17T21:40:00+09:00"


def test_event_without_timezone_is_treated_as_jst():
    raw = {"id": "e", "subject": "会議", "categories": [],
           "start": {"dateTime": "2026-11-18T09:30:00"},
           "end": {"dateTime": "2026-11-18T10:00:00"}}
    assert normalize_event(raw)["start_at"] == "2026-11-18T09:30:00+09:00"


def test_m365_mode_is_not_connected_yet(client, monkeypatch):
    """異常系：実連携モードで未接続なら、取り込まずに 503 を返す。"""
    monkeypatch.setattr(config, "DATA_MODE", "m365")
    res = client.post("/api/ingest")
    assert res.status_code == 503
    assert "未接続" in res.json()["detail"]


def test_demo_and_m365_use_separate_db_files():
    """デモと実環境のデータを混在させない（別ファイル）。"""
    assert config.db_path("demo") != config.db_path("m365")


def test_reset_clears_demo_data(client):
    client.post("/api/ingest")
    assert client.post("/api/demo/reset").status_code == 200
    assert client.get("/api/messages").json() == []

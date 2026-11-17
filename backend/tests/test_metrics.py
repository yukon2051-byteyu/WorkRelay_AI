"""ステップ8：改善レポートのテスト。"""
import time


def _setup(client):
    client.post("/api/ingest")
    return {r["title"]: r for r in client.get("/api/requests").json()}


def test_report_labels_distinguish_sources(client):
    """サンプル値・デモ中の実測値・実利用の計測値を区別して返す。"""
    _setup(client)
    r = client.get("/api/report").json()
    assert set(r["labels"]) == {"sample", "measured", "real"}
    assert r["morning"]["real"] is None  # 実利用はまだ計測していない
    s = r["morning"]["sample"]
    assert s["before"]["median_minutes"] == 32 and s["before"]["days"] == 20 and s["before"]["period"]


def test_round_trips_and_time_to_ready(client):
    reqs = _setup(client)
    flow = client.get("/api/report").json()["flow"]
    expense = next(x for x in flow["rows"] if x["title"] == "経費一覧の抽出")
    assert expense["round_trips"] == 1          # 前日に確認を1回送った
    assert expense["hours_to_ready"] == 7.6     # 11/17 11:30 受信 → 19:05 の回答で着手可能
    assert expense["complete_first"] is False
    data = next(t for t in flow["by_type"] if t["type"] == "データ抽出")
    assert data["count"] == 3 and data["ready_count"] == 1  # 比較には対象件数も出す
    assert flow["period"] and flow["condition"]


def test_round_trip_increases_after_user_sends_confirmation(client):
    reqs = _setup(client)
    rid = reqs["来週の予算会議の資料"]["id"]
    draft = client.get(f"/api/requests/{rid}").json()["drafts"][0]
    client.post(f"/api/drafts/{draft['id']}/sent")
    row = next(x for x in client.get("/api/report").json()["flow"]["rows"] if x["id"] == rid)
    assert row["round_trips"] == 1


def test_missing_fields_by_type_with_counts(client):
    """依頼種別ごとに、初回の依頼で抜けた項目と件数を出す。"""
    _setup(client)
    missing = {m["type"]: m for m in client.get("/api/report").json()["missing"]}
    data = missing["データ抽出"]
    assert data["count"] == 3
    assert data["fields"][0] == {"field": "集計単位", "count": 3}
    assert {"field": "対象部門", "count": 1} in data["fields"]
    assert "受付テンプレートに『集計単位』" in data["hint"]


def test_draft_usage_counts(client):
    reqs = _setup(client)
    usage = client.get("/api/report").json()["drafts"]["drafts"]
    assert usage == {"as_is": 0, "edited": 0, "unused": 0, "pending": 3}
    drafts = {d["kind"]: d for r in reqs.values() for d in client.get(f"/api/requests/{r['id']}").json()["drafts"]}
    client.post(f"/api/drafts/{drafts['confirm']['id']}/save")                       # そのまま使った
    client.patch(f"/api/drafts/{drafts['due_adjust']['id']}", json={"body": "書き換えた本文"})
    client.post(f"/api/drafts/{drafts['due_adjust']['id']}/copy")                    # 編集して使った
    client.post(f"/api/drafts/{drafts['answer']['id']}/discard")                     # 使わなかった
    usage = client.get("/api/report").json()["drafts"]["drafts"]
    assert usage == {"as_is": 1, "edited": 1, "unused": 1, "pending": 0}


def test_morning_planning_time_is_measured_from_usage(client):
    _setup(client)
    client.post("/api/usage", json={"session_id": "s1", "kind": "home_open"})
    time.sleep(1.1)
    client.post("/api/usage", json={"session_id": "s1", "kind": "first_action", "request_id": 1})
    client.post("/api/usage", json={"session_id": "s1", "kind": "first_action"})  # 2回目以降は数えない
    m = client.get("/api/report").json()["morning"]["measured"]
    assert m["count"] == 1 and m["latest_seconds"] >= 1


def test_usage_validation(client):
    assert client.post("/api/usage", json={"session_id": "s1", "kind": "xxx"}).status_code == 400
    assert client.post("/api/usage", json={"session_id": "", "kind": "home_open"}).status_code == 400

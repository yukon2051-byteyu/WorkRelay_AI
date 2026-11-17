"""ステップ7：作業枠の候補と、予定表への登録のテスト。"""
from datetime import datetime

from app.config import JST
from app.planning import schedule


def _setup(client):
    client.post("/api/ingest")
    return {r["title"]: r for r in client.get("/api/requests").json()}


def _detail(client, rid):
    return client.get(f"/api/requests/{rid}").json()


def _flat(client):
    return [c for s in client.get("/api/home").json()["sections"] for c in s["items"]]


# ---------------------------------------------------------------- 候補

def test_expense_slot_candidates(client):
    """経費一覧（45分・期限11/20 18:00）は、今日の空きから早い順に候補が出る（シナリオ4）。"""
    reqs = _setup(client)
    p = _detail(client, reqs["経費一覧の抽出"]["id"])["slot_plan"]
    assert p["enough"] is True and p["needs_effort"] is False
    starts = [(c["start"][5:16], c["end"][11:16]) for c in p["candidates"]]
    assert starts[:3] == [("11-18T11:00", "11:45"), ("11-18T14:30", "15:15"), ("11-18T17:00", "17:45")]
    assert all(c["before_deadline"] for c in p["candidates"])


def test_not_enough_time_offers_options(client):
    """確定期限を11:00に早めた売上資料：期限までの空き30分＜必要60分 → 選べる対応を出す。"""
    reqs = _setup(client)
    rid = next(r["id"] for t, r in reqs.items() if t.startswith("売上資料"))
    cand = _detail(client, rid)["candidates"][0]["id"]
    client.post(f"/api/candidates/{cand}/accept")
    client.post(f"/api/requests/{rid}/due-decision", json={"decision": "accept"})
    p = _detail(client, rid)["slot_plan"]
    assert p["enough"] is False
    assert p["free_before_deadline"] == 30
    assert [o["kind"] for o in p["options"]] == ["quick", "consult"]
    # 「期限を相談する」→ 数字の入った相談の返信案
    d = client.post(f"/api/requests/{rid}/drafts", json={"kind": "schedule_consult"}).json()
    assert "30分" in d["body"] and "60分" in d["body"] and "本日12:00" in d["body"]


def test_unknown_effort_asks_for_estimate(client):
    reqs = _setup(client)
    p = _detail(client, reqs["来週の予算会議の資料"]["id"])["slot_plan"]
    assert p["needs_effort"] is True and p["candidates"] == []


def test_plan_unit_skips_weekend_and_busy():
    now = datetime(2026, 11, 20, 17, 30, tzinfo=JST)  # 金曜 17:30
    p = schedule.plan([], now, 60, None)
    # 金曜は残り30分しかないので、次は月曜（11/23）の朝
    assert p["candidates"][0]["start"] == "2026-11-23T09:00:00+09:00"


# ---------------------------------------------------------------- 登録

def test_register_slot_updates_calendar_and_home(client):
    """利用者が選んだ枠を登録すると、予定表と今日の空き時間・カードに反映される（シナリオ4）。"""
    reqs = _setup(client)
    rid = reqs["経費一覧の抽出"]["id"]
    before_free = sum(s["minutes"] for s in client.get("/api/home").json()["free_slots"])
    res = client.post(f"/api/requests/{rid}/work-slots",
                      json={"start": "2026-11-18T11:00:00+09:00", "end": "2026-11-18T11:45:00+09:00"})
    assert res.status_code == 200
    ev = res.json()
    assert ev["kind"] == "work" and ev["request_id"] == rid and ev["title"] == "【作業】経費一覧の抽出"
    after_free = sum(s["minutes"] for s in client.get("/api/home").json()["free_slots"])
    assert before_free - after_free == 45
    card = next(c for c in _flat(client) if c["request_id"] == rid)
    assert card["next_action"] == "経費一覧の抽出を仕上げる" and "作業枠 11:00–11:45 登録済み" in card["why_now"]
    hist = _detail(client, rid)["history"]
    assert any(h["kind"] == "slot" and h["actor"] == "user" and "11:00" in h["note"] for h in hist)
    # 再取り込みしても、登録した枠は消えない・増えない
    client.post("/api/ingest")
    assert len([e for e in client.get("/api/events").json() if e["request_id"] == rid]) == 1


def test_nothing_registered_without_user_action(client):
    """取り込みや下書きの準備だけでは、予定表に登録されない（完了条件）。"""
    _setup(client)
    assert len(client.get("/api/events").json()) == 5


def test_register_rejects_conflicts_and_invalid_times(client):
    reqs = _setup(client)
    rid = reqs["経費一覧の抽出"]["id"]
    url = f"/api/requests/{rid}/work-slots"
    # 会議と重なる
    r = client.post(url, json={"start": "2026-11-18T09:45:00+09:00", "end": "2026-11-18T10:30:00+09:00"})
    assert r.status_code == 400 and "チーム朝会" in r.json()["detail"]
    # 昼休みと重なる
    assert client.post(url, json={"start": "2026-11-18T11:30:00+09:00", "end": "2026-11-18T12:15:00+09:00"}).status_code == 400
    # 勤務時間外・終了が開始より前・過去・日時でない・タイムゾーンなし
    assert client.post(url, json={"start": "2026-11-18T18:00:00+09:00", "end": "2026-11-18T18:45:00+09:00"}).status_code == 400
    assert client.post(url, json={"start": "2026-11-18T15:00:00+09:00", "end": "2026-11-18T14:30:00+09:00"}).status_code == 400
    assert client.post(url, json={"start": "2026-11-17T15:00:00+09:00", "end": "2026-11-17T15:45:00+09:00"}).status_code == 400
    assert client.post(url, json={"start": "あした", "end": "あさって"}).status_code == 400
    assert client.post(url, json={"start": "2026-11-18T15:00:00", "end": "2026-11-18T15:45:00"}).status_code == 400
    assert client.post("/api/requests/999/work-slots",
                       json={"start": "2026-11-18T15:00:00+09:00", "end": "2026-11-18T15:45:00+09:00"}).status_code == 404
    # 同じ枠を二重に登録できない
    ok = {"start": "2026-11-18T14:30:00+09:00", "end": "2026-11-18T15:15:00+09:00"}
    assert client.post(url, json=ok).status_code == 200
    assert client.post(url, json=ok).status_code == 400


def test_unregister_slot(client):
    reqs = _setup(client)
    rid = reqs["経費一覧の抽出"]["id"]
    ev = client.post(f"/api/requests/{rid}/work-slots",
                     json={"start": "2026-11-18T17:00:00+09:00", "end": "2026-11-18T17:45:00+09:00"}).json()
    assert client.delete(f"/api/work-slots/{ev['id']}").status_code == 200
    assert not [e for e in client.get("/api/events").json() if e["request_id"] == rid]
    assert any("取り消し" in (h["note"] or "") for h in _detail(client, rid)["history"])
    # 会議は取り消せない、存在しない予定は404
    meeting = next(e for e in client.get("/api/events").json() if e["kind"] == "meeting")
    assert client.delete(f"/api/work-slots/{meeting['id']}").status_code == 400
    assert client.delete("/api/work-slots/999").status_code == 404

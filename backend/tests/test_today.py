"""ステップ4：「今日やること」と優先順位のテスト。"""
from datetime import datetime

from app.config import JST
from app.planning.slots import free_minutes_until, free_slots


def _home(client):
    return client.get("/api/home").json()


def _flat(home):
    return [c for s in home["sections"] for c in s["items"]]


def test_top_card_is_quick_confirmation_to_sales(client):
    """期限が前倒しされた売上資料は『先に速報版で足りるか確認』が最上位（シナリオ2）。"""
    client.post("/api/ingest")
    home = _home(client)
    top = _flat(home)[0]
    assert top["next_action"] == "営業に、速報版で足りるか確認する"
    assert top["section"] == "now"
    assert top["why_now"][0] == "昨夜のTeamsで期限の前倒しを依頼されました。"
    assert top["why_now"][1] == "11:00までの空きは30分、確定版には60分必要です。"
    assert top["capacity"] == {"until": "11:00", "free_minutes": 30, "need_minutes": 60}
    # 不足の判断理由は文で示し、『作業枠が不足』『作業枠あり』のバッジは一覧に重ねない
    labels = [p["label"] for p in top["prep"]]
    assert not any(l.startswith("作業枠") for l in labels)
    assert top["primary_action"]["label"] == "返信案を確認"
    # 元の確定期限と、新しい希望期限の違いが分かる
    assert top["due"]["committed"] == "2026-11-18T15:00:00+09:00"
    assert top["due"]["proposed"] == "2026-11-18T11:00:00+09:00"
    # 根拠：メールと Teams の両方
    assert {e["channel"] for e in top["evidence"]} == {"outlook", "teams"}


def test_quick_confirmation_ranks_above_earlier_deadline_work(client):
    """期限だけで機械的に並べない。短い確認（期限を確認）は、着手可能な作業より上。"""
    client.post("/api/ingest")
    actions = [c["next_action"] for c in _flat(_home(client))]
    assert actions.index("業務企画に、期限を確認する") < actions.index("経費一覧の抽出の作業枠を確保する")


def test_candidate_card_says_what_to_judge(client):
    """関連候補のカードは、何を判断するのか（既存の依頼への回答か）が伝わる文にする。"""
    client.post("/api/ingest")
    actions = [c["next_action"] for c in _flat(_home(client))]
    assert "開発からの連絡が、既存の依頼への回答か確認する" in actions


def test_waiting_requests_go_to_waiting_section(client):
    client.post("/api/ingest")
    home = _home(client)
    waiting = next(s for s in home["sections"] if s["key"] == "waiting")["items"]
    assert any("マーケティングからの回答を待つ" in c["next_action"] for c in waiting)


def test_missing_due_and_effort_are_shown(client):
    """情報が足りなければ『期限を確認』『作業時間は未見積もり』を表示する。
    行動タイトルで『期限を確認』が伝わる場合は、同じ内容のバッジを重ねない。"""
    client.post("/api/ingest")
    budget = next(c for c in _flat(_home(client)) if c["title"] == "来週の予算会議の資料")
    labels = [p["label"] for p in budget["prep"]]
    assert "期限を確認" in budget["next_action"]
    assert "期限を確認" not in labels and not any(l.startswith("不足情報") for l in labels)
    assert "作業時間は未見積もり" in labels


def test_due_badge_not_duplicated_when_title_lists_due_field(client):
    """不足が複数で、タイトルに『提出希望日時』が含まれる場合も、期限バッジを重ねない。"""
    client.post("/api/ingest")
    rid = next(c for c in _flat(_home(client)) if c["title"] == "来週の予算会議の資料")["request_id"]
    # 期限以外の不足を作る：参照データを空にすると、タイトルは『参照データ・提出希望日時を確認する』になる
    client.patch(f"/api/requests/{rid}", json={"fields": {"参照データ": ""}})
    card = next(c for c in _flat(_home(client)) if c["request_id"] == rid)
    assert "参照データ" in card["next_action"]
    assert "期限を確認" not in [p["label"] for p in card["prep"]]  # タイトルに『提出希望日時』が含まれる


def test_newly_ready_request_explains_why(client):
    client.post("/api/ingest")
    expense = next(c for c in _flat(_home(client)) if c["title"] == "経費一覧の抽出")
    assert expense["section"] == "today"
    assert "昨夜の返信で必要な情報がそろった" in expense["why_now"]


def test_home_summary_counts(client):
    client.post("/api/ingest")
    s = _home(client)["summary"]
    assert s["new_messages"] == 16  # 夜間メール12通＋Teams4件
    assert s["suspicious"] == 1


def test_user_can_reorder(client):
    """利用者は並び順を修正できる。"""
    client.post("/api/ingest")
    now_items = _home(client)["sections"][0]["items"]
    ids = [c["request_id"] for c in now_items]
    reversed_ids = list(reversed(ids))
    assert client.put("/api/home/order", json={"request_ids": reversed_ids}).status_code == 200
    assert [c["request_id"] for c in _home(client)["sections"][0]["items"]] == reversed_ids


def test_snooze_moves_card_to_later(client):
    client.post("/api/ingest")
    top = _flat(_home(client))[0]
    client.put(f"/api/requests/{top['request_id']}/snooze", json={"snoozed": True})
    home = _home(client)
    later = next(s for s in home["sections"] if s["key"] == "later")["items"]
    assert [c["request_id"] for c in later] == [top["request_id"]]
    client.put(f"/api/requests/{top['request_id']}/snooze", json={"snoozed": False})
    assert _flat(_home(client))[0]["request_id"] == top["request_id"]


def test_snooze_unknown_request_is_404(client):
    client.post("/api/ingest")
    assert client.put("/api/requests/999/snooze", json={"snoozed": True}).status_code == 404


def test_empty_home_before_ingest(client):
    """新着なし（未取り込み）でもエラーにならない。"""
    home = _home(client)
    assert _flat(home) == []
    assert home["summary"]["new_messages"] == 0


def test_after_due_decision_card_changes(client):
    """利用者が期限変更を判断した後は、確定期限が11:00になる。"""
    client.post("/api/ingest")
    top = _flat(_home(client))[0]
    rid = top["request_id"]
    cand = client.get(f"/api/requests/{rid}").json()["candidates"][0]["id"]
    client.post(f"/api/candidates/{cand}/accept")
    # 同一依頼と認めても、確定期限はそのまま → まだ『速報版で足りるか確認』
    assert _flat(_home(client))[0]["next_action"] == "営業に、速報版で足りるか確認する"
    client.post(f"/api/requests/{rid}/due-decision", json={"decision": "accept"})
    card = next(c for c in _flat(_home(client)) if c["request_id"] == rid)
    assert card["due"]["committed"] == "2026-11-18T11:00:00+09:00"
    # 13:30 の作業枠は新しい確定期限より後 → 間に合わないことを警告し、今すぐ対応に出す
    assert card["section"] == "now"
    assert "登録済みの作業枠（13:30–14:30）は確定期限より後です。" in card["why_now"]
    assert {"label": "作業枠が期限の後", "kind": "warn"} in card["prep"]


# ---------------------------------------------------------------- 空き時間

def test_free_slots_with_demo_like_calendar():
    now = datetime(2026, 11, 18, 9, 0, tzinfo=JST)
    events = [
        {"start_at": "2026-11-18T09:30:00+09:00", "end_at": "2026-11-18T10:15:00+09:00"},
        {"start_at": "2026-11-18T10:15:00+09:00", "end_at": "2026-11-18T11:00:00+09:00"},
        {"start_at": "2026-11-19T09:00:00+09:00", "end_at": "2026-11-19T18:00:00+09:00"},  # 別の日は無視
    ]
    slots = free_slots(events, now)
    assert [(a.strftime("%H:%M"), b.strftime("%H:%M")) for a, b in slots] == [
        ("09:00", "09:30"), ("11:00", "12:00"), ("13:00", "18:00")]
    assert free_minutes_until(slots, datetime(2026, 11, 18, 11, 0, tzinfo=JST)) == 30


def test_no_free_time_when_fully_booked():
    now = datetime(2026, 11, 18, 9, 0, tzinfo=JST)
    events = [{"start_at": "2026-11-18T09:00:00+09:00", "end_at": "2026-11-18T18:00:00+09:00"}]
    assert free_slots(events, now) == []


def test_suspicious_message_has_body_for_review_but_no_action_does_not(client):
    """要確認の連絡は、人が中身を確かめられるよう本文を返す。対応不要は抜粋だけ。"""
    client.post("/api/ingest")
    fyi = _home(client)["fyi"]
    sus = [m for m in fyi if m["category"] == "suspicious"]
    rest = [m for m in fyi if m["category"] == "no_action"]
    assert len(sus) == 1 and sus[0]["body"] and "保留" in sus[0]["reason"]
    assert rest and all("body" not in m for m in rest)

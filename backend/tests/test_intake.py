"""ステップ3：依頼の分類・不足情報・進行状態のテスト。"""
from datetime import datetime

import pytest

from app.config import JST
from app.intake import rules


def _setup(client):
    client.post("/api/ingest")
    return {r["title"]: r for r in client.get("/api/requests").json()}


def _sales(reqs):
    return next(r for t, r in reqs.items() if t.startswith("売上資料"))


# ---------------------------------------------------------------- シナリオ

def test_demo_requests_are_extracted(client):
    reqs = _setup(client)
    assert len(reqs) == 7  # 持ち越し3件＋夜間の新規4件
    by_status = {t: r["status"] for t, r in reqs.items()}
    assert by_status["経費一覧の抽出"] == "ready"
    assert by_status["顧客リストの抽出"] == "waiting_reply"
    assert by_status["来週の予算会議の資料"] == "needs_info"
    assert reqs["来週の予算会議の資料"]["missing_fields"] == ["提出希望日時"]  # 「期限を確認」


def test_reply_fills_fields_and_makes_request_ready(client):
    """返信で不足項目がそろった依頼は『返信待ち』→『着手可能』になる（シナリオ4）。"""
    reqs = _setup(client)
    detail = client.get(f"/api/requests/{reqs['経費一覧の抽出']['id']}").json()
    fields = {f["name"]: f for f in detail["fields"]}
    assert fields["対象部門"]["value"] == "営業部と開発部"
    assert fields["対象部門"]["missing_initially"] == 1   # 初回は抜けていた（効果測定に使う）
    assert "対象部門：営業部と開発部" in fields["対象部門"]["evidence_text"]  # 元の文を確認できる
    status_changes = [(h["old_value"], h["new_value"]) for h in detail["history"] if h["kind"] == "status"]
    assert ("返信待ち", "着手可能") in status_changes


def test_reply_alone_does_not_make_request_ready(client):
    """返信を検知しただけでは着手可能にしない（集計単位は『後で連絡』）。"""
    reqs = _setup(client)
    detail = client.get(f"/api/requests/{reqs['顧客リストの抽出']['id']}").json()
    fields = {f["name"]: f for f in detail["fields"]}
    assert fields["対象期間"]["state"] == "filled"
    assert fields["集計単位"]["state"] == "deferred"
    assert detail["status"] == "waiting_reply"


def test_teams_message_becomes_candidate_with_reasons(client):
    """別チャネル（Teams）の連絡は、根拠付きの関連候補になり、自動では反映しない。"""
    sales = _sales(_setup(client))
    detail = client.get(f"/api/requests/{sales['id']}").json()
    assert len(detail["candidates"]) == 1
    cand = detail["candidates"][0]
    assert cand["status"] == "pending"
    assert cand["message"]["channel"] == "teams"
    assert any("同じ依頼者" in r for r in cand["reasons"])
    assert any("売上資料" in r for r in cand["reasons"])
    # 判断前は、希望期限も確定期限も元のまま
    assert detail["requested_due"] == "2026-11-18T15:00:00+09:00"
    assert detail["committed_due"] == "2026-11-18T15:00:00+09:00"


def test_due_moved_up_keeps_committed_due_and_work_slot_until_user_decides(client):
    """希望期限が前倒しされても、利用者が確認するまで確定期限と作業枠を維持する（完了条件）。"""
    sales = _sales(_setup(client))
    cand_id = client.get(f"/api/requests/{sales['id']}").json()["candidates"][0]["id"]

    after_link = client.post(f"/api/candidates/{cand_id}/accept").json()
    assert after_link["requested_due"] == "2026-11-18T11:00:00+09:00"   # 新しい希望期限
    assert after_link["committed_due"] == "2026-11-18T15:00:00+09:00"   # 確定期限は維持
    assert after_link["due_change_status"] == "needs_consult"            # 変更の相談が必要
    assert after_link["work_slots"][0]["start_at"] == "2026-11-18T13:30:00+09:00"  # 作業枠も維持
    assert {m["channel"] for m in after_link["messages"]} == {"outlook", "teams"}  # 両方の根拠をたどれる

    decided = client.post(f"/api/requests/{sales['id']}/due-decision", json={"decision": "accept"}).json()
    assert decided["committed_due"] == "2026-11-18T11:00:00+09:00"
    assert decided["due_change_status"] is None
    assert any(h["actor"] == "user" and h["field"] == "確定期限" for h in decided["history"])


def test_rejected_candidate_is_not_linked(client):
    reqs = _setup(client)
    server = reqs["サーバー利用料の内訳"]
    cand_id = client.get(f"/api/requests/{server['id']}").json()["candidates"][0]["id"]
    detail = client.post(f"/api/candidates/{cand_id}/reject").json()
    assert detail["status"] == "needs_info"  # 集計単位は埋まらない
    assert all(m["channel"] == "outlook" for m in detail["messages"])


def test_accepted_candidate_fills_missing_field(client):
    reqs = _setup(client)
    server = reqs["サーバー利用料の内訳"]
    cand_id = client.get(f"/api/requests/{server['id']}").json()["candidates"][0]["id"]
    detail = client.post(f"/api/candidates/{cand_id}/accept").json()
    fields = {f["name"]: f for f in detail["fields"]}
    assert fields["集計単位"]["value"] == "サービス別"
    assert detail["status"] == "ready"


def test_reingest_does_not_duplicate_requests_or_answers(client):
    """重複取り込みをしても、依頼・回答・履歴が増えない（完了条件）。"""
    reqs = _setup(client)
    detail_before = client.get(f"/api/requests/{reqs['経費一覧の抽出']['id']}").json()
    second = client.post("/api/ingest").json()
    assert second["new_messages"] == 0
    assert second["processed"] == {}
    assert len(client.get("/api/requests").json()) == 7
    detail_after = client.get(f"/api/requests/{reqs['経費一覧の抽出']['id']}").json()
    assert len(detail_after["messages"]) == len(detail_before["messages"])
    assert len(detail_after["history"]) == len(detail_before["history"])


def test_suspicious_mail_is_not_acted_on(client):
    """本文に書かれた指示から、操作や情報送信を実行しない。"""
    _setup(client)
    msgs = client.get("/api/messages").json()
    sus = next(m for m in msgs if m["external_id"] == "mail-n09")
    assert sus["category"] == "suspicious"
    assert sus["request_id"] is None
    assert len([m for m in msgs if m["direction"] == "sent"]) == 2  # 送信は増えていない


def test_no_action_messages(client):
    _setup(client)
    msgs = {m["external_id"]: m for m in client.get("/api/messages").json()}
    for ext in ("mail-n04", "mail-n05", "mail-n10", "mail-n12", "teams-n04"):
        assert msgs[ext]["category"] == "no_action", ext


# ---------------------------------------------------------------- 利用者の操作

def test_user_can_fill_field_manually(client):
    reqs = _setup(client)
    rid = reqs["来週の予算会議の資料"]["id"]
    detail = client.patch(f"/api/requests/{rid}", json={"fields": {"提出希望日時": "2026-11-24T12:00:00+09:00"}}).json()
    assert detail["status"] == "ready"
    assert detail["history"][-1]["actor"] in ("user", "system")


def test_adding_required_field_reopens_missing(client):
    """依頼種別の必要項目を追加すると、未完了の依頼に不足項目が増える。"""
    reqs = _setup(client)
    res = client.put("/api/request-types/data_extraction",
                     json={"required_fields": ["対象期間", "対象部門", "集計単位", "提出希望日時", "提出形式"]})
    assert res.status_code == 200
    detail = client.get(f"/api/requests/{reqs['経費一覧の抽出']['id']}").json()
    assert detail["status"] == "needs_info"
    assert "提出形式" in detail["missing_fields"]


# ---------------------------------------------------------------- 異常系

def test_candidate_cannot_be_decided_twice(client):
    sales = _sales(_setup(client))
    cand_id = client.get(f"/api/requests/{sales['id']}").json()["candidates"][0]["id"]
    assert client.post(f"/api/candidates/{cand_id}/accept").status_code == 200
    assert client.post(f"/api/candidates/{cand_id}/reject").status_code == 400


def test_errors(client):
    _setup(client)
    assert client.get("/api/requests/9999").status_code == 404
    assert client.post("/api/requests/1/due-decision", json={"decision": "xxx"}).status_code == 400
    assert client.post("/api/requests/1/due-decision", json={"decision": "custom"}).status_code == 400
    assert client.post("/api/requests/1/due-decision",
                       json={"decision": "custom", "committed_due": "明日"}).status_code == 400
    assert client.patch("/api/requests/1", json={"effort_minutes": -5}).status_code == 400
    assert client.patch("/api/requests/1", json={"status": "unknown"}).status_code == 400
    assert client.put("/api/request-types/data_extraction", json={"required_fields": []}).status_code == 400


# ---------------------------------------------------------------- ルール単体

BASE = datetime(2026, 11, 17, 21, 40, tzinfo=JST)  # 火曜の夜


@pytest.mark.parametrize("text, expected, confidence", [
    ("明日（18日）の11時までに欲しい", "2026-11-18T11:00:00+09:00", "confirmed"),
    ("期限：明日15:00まで", "2026-11-18T15:00:00+09:00", "confirmed"),
    ("11/19（木）17時までにお願い", "2026-11-19T17:00:00+09:00", "confirmed"),
    ("11/20（金）中にいただけると", "2026-11-20T18:00:00+09:00", "inferred"),
    ("今週中だと助かります", "2026-11-20T18:00:00+09:00", "inferred"),
])
def test_parse_due(text, expected, confidence):
    fv = rules.parse_due(text, BASE)
    assert fv.value == expected
    assert fv.confidence == confidence


def test_meeting_time_is_not_mistaken_for_due():
    """『16:00の営業会議』は会議の時刻であって期限ではない。"""
    assert rules.parse_due("明日11/18（水）16:00の営業会議で使う資料", BASE) is None


def test_no_due_returns_none():
    assert rules.parse_due("急ぎではありません", BASE) is None


def test_deferred_answer_is_not_filled():
    f = rules.extract_fields("data_extraction", "集計単位はチーム内で確認して、明日連絡します。", None, BASE)
    assert f["集計単位"].deferred and f["集計単位"].value is None

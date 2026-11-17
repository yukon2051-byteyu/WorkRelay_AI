"""ステップ5：返信・連絡の下書きのテスト。"""


def _setup(client):
    client.post("/api/ingest")
    return {r["title"]: r for r in client.get("/api/requests").json()}


def _drafts(client, rid):
    return client.get(f"/api/requests/{rid}").json()["drafts"]


def _sales_id(reqs):
    return next(r["id"] for t, r in reqs.items() if t.startswith("売上資料"))


def _sent_count(client):
    return len([m for m in client.get("/api/messages").json() if m["direction"] == "sent"])


# ---------------------------------------------------------------- 朝の準備

def test_morning_prepares_expected_drafts(client):
    reqs = _setup(client)
    sales = _drafts(client, _sales_id(reqs))
    assert [d["kind"] for d in sales] == ["due_adjust"]
    d = sales[0]
    assert d["channel"] == "teams"  # 前倒しの連絡が来た Teams で返す
    assert "速報版" in d["body"] and "本日11:00" in d["body"] and "本日15:00" in d["body"]
    assert d["status"] == "draft" and d["generator"].startswith("デモ：テンプレート")

    budget = _drafts(client, reqs["来週の予算会議の資料"]["id"])
    assert budget[0]["kind"] == "confirm" and "提出希望日時" in budget[0]["body"]
    assert budget[0]["subject"].startswith("RE: ")

    inquiry = _drafts(client, reqs["会議室予約システムの使い方"]["id"])
    assert inquiry[0]["kind"] == "answer" and inquiry[0]["has_placeholder"]

    # 着手可能なデータ抽出（経費一覧）には、返信の下書きは要らない
    assert _drafts(client, reqs["経費一覧の抽出"]["id"]) == []


def test_no_confirmation_for_field_answered_in_pending_candidate(client):
    """Teams で回答済み（関連候補で判断待ち）の項目は、確認文で重ねて聞かない。"""
    reqs = _setup(client)
    assert _drafts(client, reqs["サーバー利用料の内訳"]["id"]) == []


def test_drafts_do_not_copy_instructions_from_suspicious_mail(client):
    _setup(client)
    all_bodies = "".join(d["body"] for r in client.get("/api/requests").json() for d in _drafts(client, r["id"]))
    assert "urgent-keiri" not in all_bodies and "社員名簿" not in all_bodies


def test_reingest_does_not_duplicate_drafts(client):
    reqs = _setup(client)
    second = client.post("/api/ingest").json()
    assert second["drafts_created"] == 0
    assert len(_drafts(client, _sales_id(reqs))) == 1


def test_home_card_shows_draft_ready(client):
    _setup(client)
    home = client.get("/api/home").json()
    top = home["sections"][0]["items"][0]
    assert top["prep"][0] == {"label": "返信案あり", "kind": "ok"}


# ---------------------------------------------------------------- 確認前に送信・保存しない

def test_nothing_is_sent_or_saved_without_user_action(client):
    """取り込み・下書きの準備だけでは、送信も保存も起きない（完了条件）。"""
    reqs = _setup(client)
    assert _sent_count(client) == 2  # 前日に利用者が送った2通だけ
    for r in reqs.values():
        assert all(d["status"] == "draft" for d in _drafts(client, r["id"]))


def test_user_sends_confirmation_then_request_waits_for_reply(client):
    reqs = _setup(client)
    rid = reqs["来週の予算会議の資料"]["id"]
    draft = _drafts(client, rid)[0]
    res = client.post(f"/api/drafts/{draft['id']}/sent")
    assert res.status_code == 200 and res.json()["status"] == "sent"
    assert _sent_count(client) == 3
    detail = client.get(f"/api/requests/{rid}").json()
    assert detail["status"] == "waiting_reply"
    assert any(h["kind"] == "question_sent" and h["actor"] == "user" for h in detail["history"])
    # 送信済みは編集・再送できない
    assert client.patch(f"/api/drafts/{draft['id']}", json={"body": "x"}).status_code == 400
    assert client.post(f"/api/drafts/{draft['id']}/sent").status_code == 400


def test_save_and_send_are_separate_states(client):
    reqs = _setup(client)
    draft = _drafts(client, reqs["来週の予算会議の資料"]["id"])[0]
    saved = client.post(f"/api/drafts/{draft['id']}/save").json()
    assert saved["status"] == "saved"
    assert _sent_count(client) == 2  # 保存しても送信はされない


def test_teams_draft_cannot_be_saved_to_outlook(client):
    reqs = _setup(client)
    draft = _drafts(client, _sales_id(reqs))[0]
    res = client.post(f"/api/drafts/{draft['id']}/save")
    assert res.status_code == 400 and "Teams" in res.json()["detail"]


# ---------------------------------------------------------------- 編集を上書きしない

def test_regenerate_keeps_user_edits(client):
    """利用者が編集した内容は、再生成で上書きしない（新しい案として別に持つ）。"""
    reqs = _setup(client)
    rid = _sales_id(reqs)
    draft = _drafts(client, rid)[0]
    edited_body = draft["body"].replace("ご確認いただけますか。", "10分ほどで速報版をお見せできます。ご確認いただけますか。")
    edited = client.patch(f"/api/drafts/{draft['id']}", json={"body": edited_body}).json()
    assert edited["is_edited"] == 1

    # 条件を変える：確定期限を 11:00 に変更 → 作り直し
    cand = client.get(f"/api/requests/{rid}").json()["candidates"][0]["id"]
    client.post(f"/api/candidates/{cand}/accept")
    client.post(f"/api/requests/{rid}/due-decision", json={"decision": "accept"})
    regen = client.post(f"/api/requests/{rid}/drafts", json={"kind": "due_adjust"}).json()
    assert regen["body"] == edited_body           # 編集内容はそのまま
    assert regen["has_new_suggestion"] == 1       # 新しい案は別にある
    applied = client.post(f"/api/drafts/{draft['id']}/apply-suggestion").json()
    assert applied["is_edited"] == 0 and applied["body"] != edited_body


def test_condition_change_marks_draft_for_review(client):
    """下書きを作った後に条件が変わったら『更新内容の確認が必要』と、何が変わったかを示す。"""
    reqs = _setup(client)
    rid = _sales_id(reqs)
    cand = client.get(f"/api/requests/{rid}").json()["candidates"][0]["id"]
    client.post(f"/api/candidates/{cand}/accept")
    # つないだだけでは、希望期限（11:00）も確定期限（15:00）も下書き作成時と同じ
    assert _drafts(client, rid)[0]["needs_review"] is False
    client.post(f"/api/requests/{rid}/due-decision", json={"decision": "accept"})
    d = _drafts(client, rid)[0]
    assert d["needs_review"] is True
    assert {"label": "確定期限", "old": "本日15:00", "new": "本日11:00"} in d["changes"]
    home = client.get("/api/home").json()
    card = next(c for s in home["sections"] for c in s["items"] if c["request_id"] == rid)
    assert card["prep"][0]["label"] == "返信案の更新確認が必要"


def test_rejecting_candidate_prepares_confirmation(client):
    """関連候補を別件とした場合は、不足項目の確認文を新しく用意する。"""
    reqs = _setup(client)
    rid = reqs["サーバー利用料の内訳"]["id"]
    cand = client.get(f"/api/requests/{rid}").json()["candidates"][0]["id"]
    client.post(f"/api/candidates/{cand}/reject")
    d = _drafts(client, rid)
    assert [x["kind"] for x in d] == ["confirm"] and "集計単位" in d[0]["body"]


def test_manual_completion_draft(client):
    reqs = _setup(client)
    rid = reqs["経費一覧の抽出"]["id"]
    d = client.post(f"/api/requests/{rid}/drafts", json={"kind": "completion"}).json()
    assert d["kind"] == "completion" and d["has_placeholder"]


# ---------------------------------------------------------------- 異常系

def test_draft_errors(client):
    reqs = _setup(client)
    draft = _drafts(client, _sales_id(reqs))[0]
    assert client.patch(f"/api/drafts/{draft['id']}", json={"body": "  "}).status_code == 400
    assert client.post(f"/api/drafts/{draft['id']}/unknown").status_code == 400
    assert client.post("/api/drafts/999/save").status_code == 404
    assert client.post(f"/api/requests/{_sales_id(reqs)}/drafts", json={"kind": "xxx"}).status_code == 400
    assert client.post("/api/requests/999/drafts", json={"kind": "confirm"}).status_code == 404
    assert client.post(f"/api/drafts/{draft['id']}/apply-suggestion").status_code == 400


def test_discarded_draft_counts_as_unused(client):
    reqs = _setup(client)
    draft = _drafts(client, reqs["会議室予約システムの使い方"]["id"])[0]
    assert client.post(f"/api/drafts/{draft['id']}/discard").json()["status"] == "discarded"

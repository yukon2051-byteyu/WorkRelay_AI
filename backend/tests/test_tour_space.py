"""デモツアー専用のデータ領域のテスト。

ツアー中の操作（関連付け・下書きの保存・予定登録・完了など）は別の DB で行い、
利用者が自由に操作しているデモのデータを変えない。
"""
import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app

TOUR = {"X-WorkRelay-Space": "tour"}


@pytest.fixture
def raw_client(tmp_path, monkeypatch):
    """get_conn を差し替えず、本物の切り替え処理を通す（DB の置き場所だけ一時フォルダに）。"""
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    return TestClient(app)


def test_tour_space_is_separate_from_demo(raw_client):
    c = raw_client
    c.post("/api/ingest")                               # 利用者のデモ
    c.post("/api/demo/reset", headers=TOUR)
    c.post("/api/ingest", headers=TOUR)                 # ツアー専用

    # 利用者がデモで作業枠を登録
    c.post("/api/requests/2/work-slots", json={"start": "2026-11-18T11:00:00+09:00", "end": "2026-11-18T11:45:00+09:00"})
    # ツアーで関連付け・期限変更・完了
    cand = c.get("/api/requests/1", headers=TOUR).json()["candidates"][0]["id"]
    c.post(f"/api/candidates/{cand}/accept", headers=TOUR)
    c.patch("/api/requests/1", json={"status": "done"}, headers=TOUR)

    demo1 = c.get("/api/requests/1").json()
    assert demo1["candidates"][0]["status"] == "pending"   # デモ側は変わらない
    assert demo1["status"] == "ready"
    assert len(c.get("/api/events").json()) == 6          # 利用者の登録はそのまま
    assert len(c.get("/api/events", headers=TOUR).json()) == 5
    assert c.get("/api/requests/1", headers=TOUR).json()["status"] == "done"

    # ツアーをやり直しても、デモ側の登録は消えない
    c.post("/api/demo/reset", headers=TOUR)
    assert len(c.get("/api/events").json()) == 6
    assert (config.DATA_DIR / "workrelay_tour.db").exists() and (config.DATA_DIR / "workrelay_demo.db").exists()


def test_download_link_can_select_tour_space(raw_client):
    c = raw_client
    c.post("/api/demo/reset", headers=TOUR)
    c.post("/api/ingest", headers=TOUR)
    doc = c.get("/api/requests/1", headers=TOUR).json()["document"]
    assert c.get(f"/api/documents/{doc['id']}/download?space=tour").status_code == 200


def test_unknown_space_rejected(raw_client):
    assert raw_client.get("/api/home", headers={"X-WorkRelay-Space": "../secret"}).status_code == 400


def test_tour_space_only_in_demo_mode(raw_client, monkeypatch):
    monkeypatch.setattr(config, "DATA_MODE", "m365")
    assert raw_client.get("/api/home", headers=TOUR).status_code == 400

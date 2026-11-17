"""公開デモ：訪問者ごとのデータ分離と、画面の配信のテスト。"""
import os
import time

import pytest
from fastapi.testclient import TestClient

from app import config, visitors
from app.main import app

A = {"X-WorkRelay-Visitor": "a" * 32}
B = {"X-WorkRelay-Visitor": "b" * 32}


@pytest.fixture
def public(tmp_path, monkeypatch):
    """公開デモとして動かす（DB の置き場所は一時フォルダ）。"""
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "PUBLIC_DEMO", True)
    return TestClient(app)


def test_first_visit_gets_demo_data_automatically(public):
    """初めての訪問者には、取り込みを押さなくてもデモデータが用意される。"""
    home = public.get("/api/home", headers=A).json()
    assert home["sections"][0]["items"][0]["next_action"] == "営業に、速報版で足りるか確認する"


def test_visitors_do_not_see_each_others_changes(public):
    """訪問者Aの操作（完了・作業枠の登録・リセット）は、訪問者Bに影響しない。"""
    public.get("/api/home", headers=A)
    public.get("/api/home", headers=B)
    public.patch("/api/requests/1", json={"status": "done"}, headers=A)
    public.post("/api/requests/2/work-slots", headers=A,
                json={"start": "2026-11-18T11:00:00+09:00", "end": "2026-11-18T11:45:00+09:00"})
    assert public.get("/api/requests/1", headers=A).json()["status"] == "done"
    assert public.get("/api/requests/1", headers=B).json()["status"] == "ready"
    assert len(public.get("/api/events", headers=B).json()) == 5
    public.post("/api/demo/reset", headers=A)
    assert len(public.get("/api/requests", headers=B).json()) == 7  # Aのリセットで、Bのデータは消えない


def test_tour_space_is_per_visitor_too(public):
    tour_a = {**A, "X-WorkRelay-Space": "tour"}
    public.patch("/api/requests/1", json={"status": "done"}, headers=tour_a)
    assert public.get("/api/requests/1", headers={**B, "X-WorkRelay-Space": "tour"}).json()["status"] == "ready"
    assert public.get("/api/requests/1", headers=A).json()["status"] == "ready"


def test_visitor_id_is_required_and_validated(public):
    assert public.get("/api/home").status_code == 400                                   # IDなし
    for bad in ["../../etc", "ABC", "a" * 8, "a" * 40, "aaaa-bbbb-cccc-dddd"]:
        assert public.get("/api/home", headers={"X-WorkRelay-Visitor": bad}).status_code == 400, bad
    # ダウンロード用のリンクは URL で訪問者IDを渡す
    public.get("/api/home", headers=A)
    doc = public.get("/api/requests/1", headers=A).json()["document"]
    assert public.get(f"/api/documents/{doc['id']}/download?visitor={'a' * 32}").status_code == 200


def test_old_visitor_data_is_cleaned_up(public):
    public.get("/api/home", headers=A)
    f = config.visitor_dir() / f"{'a' * 32}_demo.db"
    assert f.exists()
    old = time.time() - (config.VISITOR_MAX_AGE_HOURS + 1) * 3600
    os.utime(f, (old, old))
    assert visitors.cleanup(force=True) == 1 and not f.exists()
    # 次に来たときは、また最初のデモデータが用意される
    assert public.get("/api/requests/1", headers=A).json()["status"] == "ready"


def test_shared_db_when_not_public(tmp_path, monkeypatch):
    """開発中（公開デモでない）は、訪問者IDがあっても1つのデモデータを使う。"""
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    c = TestClient(app)
    c.post("/api/ingest")
    assert len(c.get("/api/requests", headers=A).json()) == 7
    assert not config.visitor_dir().exists()


def test_static_frontend_is_served(tmp_path, monkeypatch):
    """公開環境では、同じサーバーが画面も配信する。存在しない /api は 404 のまま。"""
    import importlib
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>WorkRelay</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    monkeypatch.setenv("WORKRELAY_STATIC_DIR", str(dist))
    import app.main as main_module
    m = importlib.reload(main_module)
    try:
        c = TestClient(m.app)
        assert "WorkRelay" in c.get("/").text
        assert "WorkRelay" in c.get("/report").text           # 画面内のURLにも index.html を返す
        assert c.get("/assets/app.js").status_code == 200
        assert c.get("/api/not-exist").status_code == 404
        assert c.get("/api/health").json()["status"] == "ok"
    finally:
        monkeypatch.delenv("WORKRELAY_STATIC_DIR")
        importlib.reload(main_module)

def test_health_returns_ok(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok" and body["mode"] == "demo"
    # 実連携は未実装なので、接続できない状態を返す（画面は接続ボタンを出さない）
    assert body["m365"] == {"implemented": False, "connectable": False}


def test_unknown_path_returns_404(client):
    # 異常系：存在しない URL は 404 になる
    res = client.get("/api/not-exist")
    assert res.status_code == 404

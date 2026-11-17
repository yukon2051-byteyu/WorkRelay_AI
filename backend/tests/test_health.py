def test_health_returns_ok(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "mode": "demo"}


def test_unknown_path_returns_404(client):
    # 異常系：存在しない URL は 404 になる
    res = client.get("/api/not-exist")
    assert res.status_code == 404

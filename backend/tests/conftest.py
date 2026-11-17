"""テスト共通の準備。

テストごとに一時フォルダへ新しい DB を作るので、
本番（デモ）用の DB ファイルを汚さず、テスト同士も影響しない。
"""
import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.main import app, get_conn


@pytest.fixture
def client(tmp_path):
    db_file = tmp_path / "test.db"

    def _test_conn():
        conn = connect(db_file)
        try:
            yield conn
        finally:
            conn.close()

    app.dependency_overrides[get_conn] = _test_conn
    yield TestClient(app)
    app.dependency_overrides.clear()

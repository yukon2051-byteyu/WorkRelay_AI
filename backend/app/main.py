"""WorkRelay AI バックエンドの入口。

ステップ1では「サーバーが動いているか」を返す API だけを用意する。
"""
from fastapi import FastAPI

app = FastAPI(title="WorkRelay AI")


@app.get("/api/health")
def health() -> dict:
    """死活確認用。画面からここを呼び、サーバーとつながっているかを確かめる。"""
    return {"status": "ok", "mode": "demo"}

"""アプリ全体の設定。

デモと実連携（Microsoft 365）のデータが混ざらないよう、
モードごとに別の SQLite ファイルを使う。
"""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
DATA_DIR = BASE_DIR / "data"
DEMO_DATA_DIR = Path(__file__).resolve().parent / "demo_data"

# "demo"（架空データ）または "m365"（実連携）
DATA_MODE = os.environ.get("WORKRELAY_MODE", "demo")

# デモは「2026-11-18（水）朝9時」に固定する。毎回同じ結果を再現するため。
DEMO_NOW = datetime(2026, 11, 18, 9, 0, tzinfo=JST)
# 前回の確認時刻（前日の終業後）。これ以降に届いた連絡を「新着」とみなす。
DEMO_LAST_CHECKED = datetime(2026, 11, 17, 18, 30, tzinfo=JST)


# デモの利用者（架空）。下書きの署名に使う
USER_NAME = "青木"
USER_EMAIL = "aoki.yu@example.com"

# Microsoft 365 実連携の状態。画面の案内文はこの値で切り替わる。
#   implemented：連携機能を実装済みか（ステップ9で True にする）
#   enabled    ：この環境で接続を許可するか（公開デモでは False のまま）
M365_IMPLEMENTED = False
M365_ENABLED = os.environ.get("WORKRELAY_M365_ENABLED", "false").lower() == "true"


def db_path(mode: str | None = None) -> Path:
    mode = mode or DATA_MODE
    if mode not in ("demo", "m365"):
        raise ValueError(f"不明なモードです: {mode}")
    return DATA_DIR / f"workrelay_{mode}.db"


def now() -> datetime:
    """現在時刻。デモでは固定時刻を返す。"""
    if DATA_MODE == "demo":
        return DEMO_NOW
    return datetime.now(JST)

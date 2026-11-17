"""デモ用の取り込み元。demo_data フォルダの架空 JSON を読むだけ。"""
import json
from pathlib import Path

from app.config import DEMO_DATA_DIR


class DemoSource:
    name = "demo"

    def __init__(self, data_dir: Path = DEMO_DATA_DIR):
        self.data_dir = data_dir

    def _load(self, filename: str) -> list[dict]:
        with open(self.data_dir / filename, encoding="utf-8") as f:
            return json.load(f)["value"]

    def fetch_mail(self) -> list[dict]:
        return self._load("outlook_mail.json")

    def fetch_teams_messages(self) -> list[dict]:
        return self._load("teams_chats.json")

    def fetch_events(self) -> list[dict]:
        return self._load("calendar.json")

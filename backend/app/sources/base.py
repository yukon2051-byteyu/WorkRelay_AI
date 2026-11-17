"""取り込み元の「共通の約束事」。

デモ（JSONファイル）でも Microsoft Graph でも、
この3つのメソッドを持っていれば、同じ取り込み処理に渡せる。
返すのは Graph API と同じ形の辞書（生データ）。
"""
from typing import Protocol


class Source(Protocol):
    name: str  # 'demo' / 'm365'

    def fetch_mail(self) -> list[dict]: ...

    def fetch_teams_messages(self) -> list[dict]: ...

    def fetch_events(self) -> list[dict]: ...

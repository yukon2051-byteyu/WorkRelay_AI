"""公開デモの訪問者ごとのデータ。

公開デモでは、訪問者（ブラウザ）ごとに別々の SQLite ファイルを使う。
  - 訪問者IDは画面がランダムに作る16〜32桁の英小文字・数字だけを受け付ける
    （ファイル名に使うので、「../」などでほかの場所を指定させない）
  - 初めての訪問者には、デモデータを自動で用意する（同時に2回用意しないよう、訪問者ごとに鍵をかける）
  - 一定時間使われていない訪問者のデータは消す。ファイル数にも上限を設ける
"""
import re
import threading
import time
from pathlib import Path

from app import config
from app.db import connect

VISITOR_RE = re.compile(r"^[a-z0-9]{16,32}$")
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_last_cleanup = 0.0


def is_valid(visitor: str) -> bool:
    return bool(VISITOR_RE.match(visitor))


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def ensure_prepared(path: Path, mode: str) -> None:
    """訪問者のDBがまだなければ作り、デモデータを取り込む（初回だけ）。"""
    if path.exists():
        path.touch()  # 使われた時刻を更新（古いデータの掃除の目安）
        return
    with _lock_for(str(path)):
        if path.exists():
            return
        cleanup()
        tmp = path.with_suffix(".preparing")
        if tmp.exists():
            tmp.unlink()
        conn = connect(tmp)
        try:
            if mode in ("demo", "tour"):
                # 循環 import を避けるため、ここで読み込む
                from app.pipeline import run_pipeline
                from app.sources.demo import DemoSource
                run_pipeline(conn, DemoSource())
        finally:
            conn.close()
        tmp.replace(path)  # 準備が終わってから正式な名前にする（途中のファイルを使わせない）


def cleanup(now: float | None = None, force: bool = False) -> int:
    """古い訪問者データを消す。頻繁に走らないよう、10分に1回まで。消した数を返す。"""
    global _last_cleanup
    now = now or time.time()
    if not force and now - _last_cleanup < 600:
        return 0
    _last_cleanup = now
    d = config.visitor_dir()
    if not d.exists():
        return 0
    files = sorted(d.glob("*.db"), key=lambda p: p.stat().st_mtime)
    removed = 0
    limit = now - config.VISITOR_MAX_AGE_HOURS * 3600
    for i, f in enumerate(files):
        too_old = f.stat().st_mtime < limit
        too_many = len(files) - i > config.VISITOR_MAX_FILES
        if too_old or too_many:
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass  # 使用中などで消せないものは、次の機会に
    return removed

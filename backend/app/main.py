"""WorkRelay AI バックエンドの入口（API の一覧）。"""
from collections.abc import Iterator
import json
import sqlite3

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from urllib.parse import quote
from pydantic import BaseModel

from app import config
from app.db import ALL_TABLES, connect
from app.documents import service as documents
from app.drafts import service as drafts
from app.intake import service as intake
from app.pipeline import run_pipeline
from app.planning import today, work_slots
from app.sources.demo import DemoSource

app = FastAPI(title="WorkRelay AI")


# 業務処理の例外を、画面で扱いやすい HTTP の応答に変換する
@app.exception_handler(LookupError)
def _not_found(_: Request, exc: LookupError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ValueError)
def _bad_request(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


def get_conn() -> Iterator[sqlite3.Connection]:
    """リクエストごとに DB へ接続し、終わったら閉じる。テストでは差し替える。"""
    conn = connect(config.db_path())
    try:
        yield conn
    finally:
        conn.close()


def get_source():
    """現在のモードに応じた取り込み元を返す。"""
    if config.DATA_MODE == "demo":
        return DemoSource()
    # 実連携はステップ9で実装する。それまでは「未接続」として扱う
    raise HTTPException(status_code=503, detail="Microsoft 365 は未接続です")


# ---------------------------------------------------------------- 基本

@app.get("/api/health")
def health() -> dict:
    """死活確認用。画面からここを呼び、サーバーとつながっているかを確かめる。"""
    return {
        "status": "ok",
        "mode": config.DATA_MODE,
        # 実連携を実装済みでも、この環境で有効でなければ接続ボタンは出さない
        "m365": {"implemented": config.M365_IMPLEMENTED,
                 "connectable": config.M365_IMPLEMENTED and config.M365_ENABLED},
    }


@app.post("/api/ingest")
def run_ingest(conn=Depends(get_conn), source=Depends(get_source)) -> dict:
    """取り込み → 依頼の処理。何度実行しても依頼や回答は重複しない。"""
    return run_pipeline(conn, source)


@app.post("/api/demo/reset")
def reset_demo(conn=Depends(get_conn)) -> dict:
    """デモを最初の状態に戻す（全データ削除）。デモモードでのみ使える。"""
    if config.DATA_MODE != "demo":
        raise HTTPException(status_code=403, detail="デモモード以外では使えません")
    for table in ALL_TABLES:
        conn.execute(f"DELETE FROM {table}")
    # 連番（AUTOINCREMENT）も戻す。毎回同じ ID で再現できるようにするため
    conn.execute("DELETE FROM sqlite_sequence")
    conn.commit()
    return {"status": "reset"}


# ---------------------------------------------------------------- 取り込んだデータ

@app.get("/api/messages")
def list_messages(new_only: bool = False, conn=Depends(get_conn)) -> list[dict]:
    """メッセージ一覧（分類結果つき）。new_only=true なら前回確認以降の受信だけ。"""
    sql = ("SELECT m.*, c.category, c.reason, c.request_id FROM messages m "
           "LEFT JOIN message_classes c ON c.message_id = m.id WHERE m.source = ?")
    params: list = [config.DATA_MODE]
    if new_only:
        sql += " AND m.direction = 'received' AND m.received_at > ?"
        params.append(config.DEMO_LAST_CHECKED.isoformat())
    sql += " ORDER BY m.received_at"
    return [dict(r) for r in conn.execute(sql, params)]


@app.get("/api/events")
def list_events(conn=Depends(get_conn)) -> list[dict]:
    rows = conn.execute("SELECT * FROM events WHERE source = ? ORDER BY start_at", [config.DATA_MODE])
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- 依頼

class RequestUpdate(BaseModel):
    status: str | None = None
    effort_minutes: int | None = None
    fields: dict[str, str] | None = None


class DueDecision(BaseModel):
    decision: str              # accept（希望期限を受ける） / keep（確定期限のまま） / custom
    committed_due: str | None = None


class RequiredFields(BaseModel):
    required_fields: list[str]


@app.get("/api/requests")
def list_requests(conn=Depends(get_conn)) -> list[dict]:
    return intake.list_requests(conn, config.DATA_MODE)


@app.get("/api/requests/{request_id}")
def get_request(request_id: int, conn=Depends(get_conn)) -> dict:
    detail = intake.get_request(conn, request_id)
    detail["drafts"] = drafts.list_drafts(conn, request_id)
    detail["document"] = documents.get_document(conn, request_id)
    detail["files"] = documents.files_view(conn, request_id) if detail["type_code"] == "document" else []
    detail["slot_plan"] = work_slots.slot_plan(conn, request_id)
    return detail


# 利用者の判断で状況が変わったら、新しく必要になった下書きだけを用意する（既存の下書きは変えない）

@app.patch("/api/requests/{request_id}")
def update_request(request_id: int, body: RequestUpdate, conn=Depends(get_conn)) -> dict:
    result = intake.update_request(conn, request_id, body.model_dump(exclude_unset=True))
    drafts.prepare_drafts(conn, config.DATA_MODE)
    return result


@app.post("/api/requests/{request_id}/due-decision")
def decide_due(request_id: int, body: DueDecision, conn=Depends(get_conn)) -> dict:
    result = intake.decide_due_change(conn, request_id, body.decision, body.committed_due)
    drafts.prepare_drafts(conn, config.DATA_MODE)
    return result


@app.post("/api/candidates/{candidate_id}/accept")
def accept_candidate(candidate_id: int, conn=Depends(get_conn)) -> dict:
    result = intake.decide_candidate(conn, candidate_id, accept=True)
    drafts.prepare_drafts(conn, config.DATA_MODE)
    return result


@app.post("/api/candidates/{candidate_id}/reject")
def reject_candidate(candidate_id: int, conn=Depends(get_conn)) -> dict:
    result = intake.decide_candidate(conn, candidate_id, accept=False)
    drafts.prepare_drafts(conn, config.DATA_MODE)
    return result


@app.get("/api/request-types")
def list_request_types(conn=Depends(get_conn)) -> list[dict]:
    intake.ensure_request_types(conn)
    rows = conn.execute("SELECT * FROM request_types ORDER BY code").fetchall()
    return [{**dict(r), "required_fields": json.loads(r["required_fields"])} for r in rows]


@app.put("/api/request-types/{code}")
def update_request_type(code: str, body: RequiredFields, conn=Depends(get_conn)) -> dict:
    return intake.set_required_fields(conn, code, body.required_fields)


# ---------------------------------------------------------------- 下書き

class DraftCreate(BaseModel):
    kind: str  # due_adjust / confirm / answer / completion


class DraftEdit(BaseModel):
    body: str


@app.post("/api/requests/{request_id}/drafts")
def create_draft(request_id: int, body: DraftCreate, conn=Depends(get_conn)) -> dict:
    """利用者の操作で下書きを作る／作り直す（編集済みの本文は上書きしない）。"""
    return drafts.generate(conn, request_id, body.kind)


@app.patch("/api/drafts/{draft_id}")
def edit_draft(draft_id: int, body: DraftEdit, conn=Depends(get_conn)) -> dict:
    return drafts.edit(conn, draft_id, body.body)


@app.post("/api/drafts/{draft_id}/{action}")
def draft_action(draft_id: int, action: str, conn=Depends(get_conn)) -> dict:
    """copy / save（Outlookに下書き保存） / sent（送信したことを記録） / discard / apply-suggestion。
    いずれも画面で内容を確認した利用者の操作から呼ばれる。自動では呼ばない。"""
    return drafts.act(conn, draft_id, action)


# ---------------------------------------------------------------- 会議資料

class FilePermission(BaseModel):
    file_name: str
    allowed: bool


@app.put("/api/requests/{request_id}/files")
def set_file_permission(request_id: int, body: FilePermission, conn=Depends(get_conn)) -> dict:
    """この依頼で参照してよいファイルを、利用者が許可する／取り消す。"""
    documents.set_permission(conn, request_id, body.file_name, body.allowed)
    return {"files": documents.files_view(conn, request_id)}


@app.post("/api/requests/{request_id}/document")
def create_document(request_id: int, conn=Depends(get_conn)) -> dict:
    """会議資料のたたき台を作る／作り直す。"""
    return documents.generate(conn, request_id)


@app.get("/api/documents/{document_id}/download")
def download_document(document_id: int, conn=Depends(get_conn)) -> Response:
    name, data = documents.download(conn, document_id)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        # 日本語のファイル名は RFC 5987 の形式で渡す
        headers={"Content-Disposition": f"attachment; filename=\"deck.pptx\"; filename*=UTF-8''{quote(name)}"},
    )


# ---------------------------------------------------------------- 作業枠（予定表への登録）

class SlotCreate(BaseModel):
    start: str
    end: str


@app.post("/api/requests/{request_id}/work-slots")
def create_work_slot(request_id: int, body: SlotCreate, conn=Depends(get_conn)) -> dict:
    """利用者が確認した枠を、デモ内の予定表に登録する（自動では呼ばない）。"""
    event = work_slots.register(conn, request_id, body.start, body.end)
    drafts.prepare_drafts(conn, config.DATA_MODE)
    return event


@app.delete("/api/work-slots/{event_id}")
def delete_work_slot(event_id: int, conn=Depends(get_conn)) -> dict:
    work_slots.unregister(conn, event_id)
    return {"status": "deleted"}


# ---------------------------------------------------------------- 今日やること

class ManualOrder(BaseModel):
    request_ids: list[int]


class Snooze(BaseModel):
    snoozed: bool


@app.get("/api/home")
def home(conn=Depends(get_conn)) -> dict:
    return today.build_home(conn, config.DATA_MODE, config.now(), config.DEMO_LAST_CHECKED)


@app.put("/api/home/order")
def set_order(body: ManualOrder, conn=Depends(get_conn)) -> dict:
    """利用者が変更した並び順を保存する。"""
    today.set_manual_order(conn, body.request_ids)
    return {"status": "saved"}


@app.put("/api/requests/{request_id}/snooze")
def snooze(request_id: int, body: Snooze, conn=Depends(get_conn)) -> dict:
    intake.get_request(conn, request_id)  # 存在しなければ 404
    today.set_snoozed(conn, request_id, body.snoozed)
    return {"status": "saved"}

"""ステップ6：売上Excelの集計と PowerPoint 出力のテスト。"""
from io import BytesIO

from openpyxl import load_workbook
from pptx import Presentation

from app.documents import deck, sales
from app.documents.service import FILES_DIR

XLSX = "2026年度_売上実績.xlsx"


def _setup(client):
    client.post("/api/ingest")
    return {r["title"]: r for r in client.get("/api/requests").json()}


def _sales_id(reqs):
    return next(r["id"] for t, r in reqs.items() if t.startswith("売上資料"))


def _expected_by_dept(month: str) -> dict[str, int]:
    """テスト側で、Excel の行を直接足し算して正解を作る（アプリの集計処理は使わない）。"""
    ws = load_workbook(FILES_DIR / XLSX, read_only=True)["売上実績"]
    out: dict[str, int] = {}
    for ym, dept, _cat, amount in list(ws.iter_rows(values_only=True))[1:]:
        if ym == month:
            out[dept] = out.get(dept, 0) + amount
    return out


def _pptx(client, doc_id) -> Presentation:
    res = client.get(f"/api/documents/{doc_id}/download")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.presentationml")
    assert "filename*=UTF-8''" in res.headers["content-disposition"]
    return Presentation(BytesIO(res.content))


def _all_text(prs) -> str:
    texts = []
    for s in prs.slides:
        for sh in s.shapes:
            if sh.has_text_frame:
                texts.append(sh.text_frame.text)
            if sh.has_table:
                texts += [c.text for r in sh.table.rows for c in r.cells]
    return "\n".join(texts)


# ---------------------------------------------------------------- 正常系

def test_morning_prepares_deck_from_allowed_excel(client):
    reqs = _setup(client)
    detail = client.get(f"/api/requests/{_sales_id(reqs)}").json()
    assert detail["files"] == [{"name": XLSX, "allowed": True}]
    doc = detail["document"]
    c = doc["content"]
    assert c["complete"] and c["unconfirmed"] == []
    assert c["title"] == "【速報版】10月 売上の概要（営業会議用）"
    assert [s["title"] for s in c["slides"]] == ["概要", "数字と変化（部門別・前月比）", "会議で確認したいこと"]
    assert c["source"]["file"] == XLSX and c["source"]["sheet"] == "売上実績"
    assert c["source"]["period"] == "2026年10月（比較：2026年9月）"
    assert "10月の売上を部門別に" in c["source"]["period_evidence"]  # 対象期間の根拠
    assert c["source"]["row_count"] == 24  # 2か月 × 4部門 × 3商品区分


def test_numbers_match_source_excel(client):
    """資料の数値が、元データの集計結果と一致する（完了条件）。"""
    reqs = _setup(client)
    doc = client.get(f"/api/requests/{_sales_id(reqs)}").json()["document"]
    cur, prev = _expected_by_dept("2026-10"), _expected_by_dept("2026-09")
    agg = {d["dept"]: d for d in doc["content"]["aggregates"]["depts"]}
    assert {k: v["current"] for k, v in agg.items()} == cur
    assert {k: v["previous"] for k, v in agg.items()} == prev

    # ダウンロードした PowerPoint の表の数値も同じ（万円単位）
    prs = _pptx(client, doc["id"])
    assert len(prs.slides) == 3
    table = next(sh.table for sh in prs.slides[1].shapes if sh.has_table)
    rows = {table.cell(r, 0).text: table.cell(r, 2).text for r in range(1, len(table.rows))}
    for dept, amount in cur.items():
        assert rows[dept] == f"{round(amount / 10_000):,}"
    assert rows["合計"] == f"{round(sum(cur.values()) / 10_000):,}"


def test_pptx_is_editable_and_has_sources(client):
    """表とグラフは PowerPoint で編集できる本物の表・グラフ。各スライドに出典がある。"""
    reqs = _setup(client)
    doc = client.get(f"/api/requests/{_sales_id(reqs)}").json()["document"]
    prs = _pptx(client, doc["id"])
    shapes2 = list(prs.slides[1].shapes)
    assert any(sh.has_table for sh in shapes2) and any(sh.has_chart for sh in shapes2)
    for slide in prs.slides:
        text = "\n".join(sh.text_frame.text for sh in slide.shapes if sh.has_text_frame)
        assert f"出典：{XLSX}／シート「売上実績」／対象：2026年10月（比較：2026年9月）" in text
    # 編集して保存し直せる（python-pptx で書き換え → 保存 → 再読込）
    first = next(sh for sh in prs.slides[0].shapes if sh.has_text_frame and "総売上" in sh.text_frame.text)
    first.text_frame.paragraphs[0].runs[0].text += "（編集）"
    buf = BytesIO()
    prs.save(buf)
    assert "（編集）" in _all_text(Presentation(BytesIO(buf.getvalue())))


def test_home_card_shows_document_ready(client):
    _setup(client)
    top = client.get("/api/home").json()["sections"][0]["items"][0]
    assert top["has_document"] is True
    assert [p["label"] for p in top["prep"][:2]] == ["返信案あり", "資料下書きあり"]


# ---------------------------------------------------------------- 元データ不足

def test_without_permission_numbers_are_unconfirmed(client):
    """参照を許可したファイルがなければ、構成と確認事項までを作り、数値は『要確認』（完了条件）。"""
    reqs = _setup(client)
    rid = reqs["来週の予算会議の資料"]["id"]
    doc = client.post(f"/api/requests/{rid}/document").json()
    c = doc["content"]
    assert c["complete"] is False
    assert any("参照を許可した売上データがありません" in u for u in c["unconfirmed"])
    assert c["slides"][1]["table"]["rows"] == [["要確認"] * 5]
    prs = _pptx(client, doc["id"])
    assert len(prs.slides) == 3 and "要確認" in _all_text(prs)


def test_month_not_in_data_is_unconfirmed():
    rows = sales.read_rows(FILES_DIR / XLSX)
    agg = sales.aggregate_by_dept(rows, "2026-12")
    assert agg["missing"] is True
    c = deck.build_content(meeting="営業会議", month="2026-12", month_evidence=None, file_name=XLSX, agg=agg,
                           error=None, speed=False, committed_label=None, aggregated_at="x")
    assert not c["complete"]
    assert any("2026年12月" in u and "2026-04〜2026-10" in u for u in c["unconfirmed"])
    assert "要確認" in c["slides"][0]["bullets"][0]


def test_revoking_permission_marks_document_for_review(client):
    reqs = _setup(client)
    rid = _sales_id(reqs)
    client.put(f"/api/requests/{rid}/files", json={"file_name": XLSX, "allowed": False})
    doc = client.get(f"/api/requests/{rid}").json()["document"]
    assert doc["needs_review"] and doc["changes"][0]["label"] == "参照するファイル"
    regenerated = client.post(f"/api/requests/{rid}/document").json()
    assert regenerated["version"] == 2 and regenerated["content"]["complete"] is False


def test_due_decision_marks_document_for_review(client):
    reqs = _setup(client)
    rid = _sales_id(reqs)
    cand = client.get(f"/api/requests/{rid}").json()["candidates"][0]["id"]
    client.post(f"/api/candidates/{cand}/accept")
    client.post(f"/api/requests/{rid}/due-decision", json={"decision": "accept"})
    doc = client.get(f"/api/requests/{rid}").json()["document"]
    assert {"label": "確定期限", "old": "本日15:00", "new": "本日11:00"} in doc["changes"]


# ---------------------------------------------------------------- 異常系

def test_document_errors(client):
    reqs = _setup(client)
    rid = _sales_id(reqs)
    # 一覧にないファイル・フォルダの外を指すファイル名は受け付けない
    assert client.put(f"/api/requests/{rid}/files", json={"file_name": "../../app/config.py", "allowed": True}).status_code == 404
    assert client.put("/api/requests/999/files", json={"file_name": XLSX, "allowed": True}).status_code == 404
    # 資料作成でない依頼には作らない
    assert client.post(f"/api/requests/{reqs['経費一覧の抽出']['id']}/document").status_code == 400
    assert client.get("/api/documents/999/download").status_code == 404


def test_wrong_sheet_is_reported(tmp_path):
    from openpyxl import Workbook
    wb = Workbook()
    wb.active.title = "別のシート"
    path = tmp_path / "x.xlsx"
    wb.save(path)
    try:
        sales.read_rows(path)
        raise AssertionError("ValueError が出るはず")
    except ValueError as e:
        assert "売上実績" in str(e)


def test_reingest_does_not_duplicate_document(client):
    reqs = _setup(client)
    assert client.post("/api/ingest").json()["documents_created"] == 0
    assert client.get(f"/api/requests/{_sales_id(reqs)}").json()["document"]["version"] == 1

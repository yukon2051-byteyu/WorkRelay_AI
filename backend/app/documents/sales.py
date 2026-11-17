"""売上Excelの読み込みと集計（DB に触らない純粋な関数）。

資料に載せる数値は、必ずここで元データから計算する。手で数値を書かない。
"""
from pathlib import Path

from openpyxl import load_workbook

SHEET = "売上実績"
COLUMNS = ["年月", "部門", "商品区分", "売上金額（円）"]


def read_rows(path: Path) -> list[dict]:
    """シート『売上実績』の全行を読む。列名が違えば ValueError（想定外のファイル）。"""
    wb = load_workbook(path, read_only=True, data_only=True)
    if SHEET not in wb.sheetnames:
        raise ValueError(f"シート『{SHEET}』がありません（あるシート：{', '.join(wb.sheetnames)}）")
    rows = list(wb[SHEET].iter_rows(values_only=True))
    header = [str(h) if h is not None else "" for h in rows[0]]
    if header[:4] != COLUMNS:
        raise ValueError(f"列名が想定と違います：{header[:4]}")
    out = []
    for r in rows[1:]:
        if r[0] is None:
            continue
        out.append({"month": str(r[0]), "dept": str(r[1]), "category": str(r[2]), "amount": int(r[3] or 0)})
    return out


def prev_month(month: str) -> str:
    y, m = map(int, month.split("-"))
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def aggregate_by_dept(rows: list[dict], month: str) -> dict:
    """部門別に、対象月と前月の売上を合計する。対象月のデータが無ければ missing=True。"""
    months = sorted({r["month"] for r in rows})
    prev = prev_month(month)
    used = [r for r in rows if r["month"] in (month, prev)]
    if not any(r["month"] == month for r in rows):
        return {"missing": True, "month": month, "prev_month": prev, "available": months, "depts": [], "row_count": 0}

    depts: dict[str, dict] = {}
    for r in used:
        d = depts.setdefault(r["dept"], {"dept": r["dept"], "current": 0, "previous": 0})
        d["current" if r["month"] == month else "previous"] += r["amount"]
    result = []
    for d in depts.values():
        d["diff"] = d["current"] - d["previous"]
        d["rate"] = round(d["diff"] / d["previous"] * 100, 1) if d["previous"] else None
        result.append(d)
    total_cur = sum(d["current"] for d in result)
    total_prev = sum(d["previous"] for d in result)
    return {
        "missing": False,
        "month": month,
        "prev_month": prev,
        "available": months,
        "depts": result,
        "total": {"current": total_cur, "previous": total_prev, "diff": total_cur - total_prev,
                  "rate": round((total_cur - total_prev) / total_prev * 100, 1) if total_prev else None},
        "row_count": len(used),
    }


def man_yen(value: int | None) -> str:
    """12,345,000 → 『1,235万円』（万円単位・四捨五入）"""
    if value is None:
        return "要確認"
    return f"{round(value / 10_000):,}万円"


def pct(rate: float | None) -> str:
    if rate is None:
        return "要確認"
    return f"{rate:+.1f}%"

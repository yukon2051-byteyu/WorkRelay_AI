"""デモ用の架空の売上Excel（2026年度_売上実績.xlsx）を作る。

実行：backend フォルダで  .venv\\Scripts\\python.exe scripts\\make_demo_excel.py
乱数は使わず固定の係数で作るので、何度実行しても同じ数値になる。
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

OUT = Path(__file__).resolve().parent.parent / "app" / "demo_data" / "files" / "2026年度_売上実績.xlsx"

MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
# 部門 × 商品区分 の基準額（円）
BASE = {
    "第1営業部": {"製品A": 18_200_000, "製品B": 9_400_000, "サービス": 4_100_000},
    "第2営業部": {"製品A": 15_600_000, "製品B": 11_300_000, "サービス": 3_800_000},
    "法人営業部": {"製品A": 22_500_000, "製品B": 6_200_000, "サービス": 8_900_000},
    "オンライン販売": {"製品A": 7_300_000, "製品B": 5_600_000, "サービス": 1_200_000},
}
# 月ごとの係数（季節の波）
MONTH_FACTOR = [1.00, 0.97, 1.04, 1.02, 0.93, 1.06, 1.05]
# 10月だけ部門ごとの動きを付ける（会議で確認したい論点になる）
OCT_DEPT = {"第1営業部": 1.03, "第2営業部": 0.99, "法人営業部": 1.18, "オンライン販売": 0.88}


def main() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "売上実績"
    ws.append(["年月", "部門", "商品区分", "売上金額（円）"])
    for c in ws[1]:
        c.font = Font(bold=True)
    for i, month in enumerate(MONTHS):
        for dept, cats in BASE.items():
            for cat, base in cats.items():
                factor = MONTH_FACTOR[i] * (OCT_DEPT[dept] if month == "2026-10" else 1.0)
                ws.append([month, dept, cat, round(base * factor, -3)])  # 千円単位で丸める
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["D"].width = 16

    note = wb.create_sheet("説明")
    note.append(["このファイルは WorkRelay AI のデモ用に作った架空のデータです。実在の企業・数値とは関係ありません。"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"作成しました：{OUT}（{ws.max_row - 1}行）")


if __name__ == "__main__":
    main()

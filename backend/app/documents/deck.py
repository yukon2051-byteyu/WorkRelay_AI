"""会議資料（3枚）の内容づくりと、PowerPoint ファイルへの書き出し。

構成は「概要」「数字と変化」「会議で確認したいこと」。
数値は sales.aggregate_by_dept の結果だけを使い、各スライドに出典（ファイル・シート・対象期間）を入れる。
元データが足りないときは、構成と確認事項までを作り、数値欄は「要確認」にする。
"""
from io import BytesIO

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Inches, Pt

from app.documents.sales import man_yen, pct

UNCONFIRMED = "要確認"


def _month_label(month: str | None) -> str:
    if not month:
        return UNCONFIRMED
    y, m = month.split("-")
    return f"{int(y)}年{int(m)}月"


def build_content(*, meeting: str | None, month: str | None, month_evidence: str | None,
                  file_name: str | None, agg: dict | None, error: str | None,
                  speed: bool, committed_label: str | None, aggregated_at: str) -> dict:
    """スライドの内容（JSON にして保存できる形）を作る。"""
    m_short = f"{int(month.split('-')[1])}月" if month else "対象月"
    prev_short = f"{int(agg['prev_month'].split('-')[1])}月" if agg else "前月"
    unconfirmed: list[str] = []
    if not month:
        unconfirmed.append("対象期間が依頼文から読み取れません。依頼者に確認してください")
    if not file_name:
        unconfirmed.append("参照を許可した売上データがありません。数値は要確認のままです")
    if error:
        unconfirmed.append(f"売上データを読み込めませんでした：{error}")
    if agg and agg["missing"]:
        rng = f"{agg['available'][0]}〜{agg['available'][-1]}" if agg["available"] else "なし"
        unconfirmed.append(f"対象期間（{_month_label(month)}）のデータがありません（ファイルにある期間：{rng}）")
    ok = bool(agg and not agg["missing"])

    source = None
    if file_name:
        source = {
            "file": file_name, "sheet": "売上実績",
            "period": f"{_month_label(month)}（比較：{_month_label(agg['prev_month']) if agg else UNCONFIRMED}）",
            "period_evidence": month_evidence, "row_count": agg["row_count"] if ok else 0,
            "aggregated_at": aggregated_at,
        }
    footer = (f"出典：{file_name}／シート「売上実績」／対象：{source['period']}／集計：{aggregated_at}"
              if source else "出典：要確認（参照を許可した売上データがありません）")

    label = "速報版" if speed else "下書き"
    title = f"【{label}】{m_short} 売上の概要" + (f"（{meeting}用）" if meeting else "")

    # 1枚目：概要
    if ok:
        ds = sorted(agg["depts"], key=lambda d: d["rate"] if d["rate"] is not None else 0)
        best, worst = ds[-1], ds[0]
        s1 = [
            f"{m_short}の総売上：{man_yen(agg['total']['current'])}（前月比 {pct(agg['total']['rate'])}）",
            f"最も伸びた部門：{best['dept']}（{pct(best['rate'])}）",
            (f"最も減った部門：{worst['dept']}（{pct(worst['rate'])}）" if worst["diff"] < 0
             else "前月より減った部門はありません"),
        ]
    else:
        s1 = [f"{m_short}の総売上：{UNCONFIRMED}", f"最も伸びた部門：{UNCONFIRMED}", f"最も減った部門：{UNCONFIRMED}"]
    if speed:
        s1.append(f"この資料は速報版です（確定版：{committed_label or UNCONFIRMED}）")

    # 2枚目：数字と変化
    header = ["部門", f"{prev_short}（万円）", f"{m_short}（万円）", "増減（万円）", "前月比"]
    if ok:
        rows = [[d["dept"], f"{round(d['previous'] / 10_000):,}", f"{round(d['current'] / 10_000):,}",
                 f"{round(d['diff'] / 10_000):+,}", pct(d["rate"])] for d in agg["depts"]]
        t = agg["total"]
        rows.append(["合計", f"{round(t['previous'] / 10_000):,}", f"{round(t['current'] / 10_000):,}",
                     f"{round(t['diff'] / 10_000):+,}", pct(t["rate"])])
        chart = {"categories": [d["dept"] for d in agg["depts"]],
                 "series": [{"name": prev_short, "values": [round(d["previous"] / 10_000) for d in agg["depts"]]},
                            {"name": m_short, "values": [round(d["current"] / 10_000) for d in agg["depts"]]}]}
    else:
        rows = [[UNCONFIRMED] * 5]
        chart = None

    # 3枚目：会議で確認したいこと
    if ok:
        s3 = [f"{best['dept']}の伸び（{pct(best['rate'])}）は一時的な要因か、今後も続く見込みか"]
        if worst["diff"] < 0:
            s3.append(f"{worst['dept']}の減少（{pct(worst['rate'])}）の理由と、来月に向けた対策")
        s3.append("商品区分別など、追加で見たい切り口はあるか")
    else:
        s3 = ["資料に使う売上データ（ファイル・対象期間）の確認", "会議で判断したいこと（論点）の確認"]
    if speed:
        s3.append(f"速報値のため、確定版（{committed_label or UNCONFIRMED}）で数値が変わる可能性があります")

    return {
        "title": title, "label": label, "complete": ok, "unconfirmed": unconfirmed, "source": source,
        "footer": footer, "aggregates": agg if ok else None,
        "slides": [
            {"title": "概要", "bullets": s1},
            {"title": "数字と変化（部門別・前月比）", "table": {"header": header, "rows": rows}, "chart": chart},
            {"title": "会議で確認したいこと", "bullets": s3},
        ],
    }


# ---------------------------------------------------------------- PowerPoint への書き出し

DARK = RGBColor(0x1F, 0x23, 0x33)
ACCENT = RGBColor(0x4B, 0x50, 0xC8)
GRAY = RGBColor(0x6B, 0x70, 0x80)
AMBER = RGBColor(0xB7, 0x79, 0x1F)
FONT = "Meiryo"  # 日本語も英数字もメイリオでそろえる（明朝とゴシックが混ざらないように）


def _set_font(font, size=None, bold=None, color=None):
    """文字の書式を設定する。日本語用のフォント（a:ea）は python-pptx に設定機能がないので直接書く。"""
    font.name = FONT  # 英数字用（a:latin）
    rpr = font._rPr
    ea = rpr.find(qn("a:ea"))
    if ea is None:
        ea = OxmlElement("a:ea")
        rpr.find(qn("a:latin")).addnext(ea)  # 決められた順番（latin の直後）に入れる
    ea.set("typeface", FONT)
    if size is not None:
        font.size = Pt(size)
    if bold is not None:
        font.bold = bold
    if color is not None:
        font.color.rgb = color


def _style(paragraph, **kw):
    for run in paragraph.runs:
        _set_font(run.font, **kw)


def _text(slide, left, top, width, height, text, size=14, bold=False, color=DARK):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    _style(p, size=size, bold=bold, color=color)
    return box


def _header(slide, deck_title: str, slide_title: str, no: int):
    bar = slide.shapes.add_shape(1, 0, 0, Inches(13.333), Inches(0.12))  # 1 = 長方形
    bar.fill.solid()
    bar.fill.fore_color.rgb = ACCENT
    bar.line.fill.background()
    _text(slide, Inches(0.6), Inches(0.35), Inches(10), Inches(0.4), deck_title, size=12, color=GRAY)
    _text(slide, Inches(0.6), Inches(0.7), Inches(12), Inches(0.8), f"{no}. {slide_title}", size=28, bold=True)


def _footer(slide, footer: str):
    _text(slide, Inches(0.6), Inches(6.9), Inches(12.1), Inches(0.4), footer, size=10, color=GRAY)


def _bullets(slide, items: list[str], top=Inches(1.8)):
    box = slide.shapes.add_textbox(Inches(0.8), top, Inches(11.7), Inches(4.6))
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = "・" + item
        _style(p, size=22, color=AMBER if "要確認" in item else DARK)
        p.space_after = Pt(14)


def render_pptx(content: dict) -> bytes:
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)  # 16:9
    blank = prs.slide_layouts[6]
    s1, s2, s3 = content["slides"]

    # 1枚目：概要
    sl = prs.slides.add_slide(blank)
    _header(sl, content["title"], s1["title"], 1)
    _bullets(sl, s1["bullets"])
    _footer(sl, content["footer"])

    # 2枚目：表（編集可能）＋グラフ（編集可能）
    sl = prs.slides.add_slide(blank)
    _header(sl, content["title"], s2["title"], 2)
    table = s2["table"]
    n_rows, n_cols = len(table["rows"]) + 1, len(table["header"])
    width = Inches(6.4) if s2["chart"] else Inches(12.1)
    gt = sl.shapes.add_table(n_rows, n_cols, Inches(0.6), Inches(1.7), width, Inches(0.45) * n_rows).table
    for c, h in enumerate(table["header"]):
        gt.cell(0, c).text = h
    for r, row in enumerate(table["rows"], start=1):
        for c, v in enumerate(row):
            gt.cell(r, c).text = v
    for r in range(n_rows):
        for c in range(n_cols):
            para = gt.cell(r, c).text_frame.paragraphs[0]
            is_header = r == 0
            is_total = not is_header and table["rows"][r - 1][0] == "合計"
            # 見出し行と合計行を太字に。見出し行の文字色は表の既定（白）のまま
            _style(para, size=13, bold=is_header or is_total, color=None if is_header else DARK)
    if s2["chart"]:
        data = CategoryChartData()
        data.categories = s2["chart"]["categories"]
        for s in s2["chart"]["series"]:
            data.add_series(f"{s['name']}（万円）", s["values"])
        gf = sl.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(7.2), Inches(1.6),
                                 Inches(5.6), Inches(4.9), data)
        ch = gf.chart
        ch.has_legend = True
        ch.legend.position = XL_LEGEND_POSITION.BOTTOM
        ch.legend.include_in_layout = False
        _set_font(ch.font, size=11)  # グラフ全体（凡例・軸）の文字
        ch.value_axis.tick_labels.font.size = Pt(10)
    _footer(sl, content["footer"])

    # 3枚目：会議で確認したいこと
    sl = prs.slides.add_slide(blank)
    _header(sl, content["title"], s3["title"], 3)
    _bullets(sl, s3["bullets"])
    _footer(sl, content["footer"])

    buf = BytesIO()
    prs.save(buf)
    return buf.getvalue()

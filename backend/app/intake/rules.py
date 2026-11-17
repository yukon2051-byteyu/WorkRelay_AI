"""依頼の分類と情報抽出のルール（デモ用の固定ルール）。

生成AIを使わず、キーワードと正規表現（文字のパターン）で判定する。
同じ入力なら必ず同じ結果になるので、デモを安定して再現できる。
将来は classify / extract_fields を生成AI版に差し替えても、
呼び出し側（service.py）は変えなくてよいように、入出力の形を固定している。

ここにある関数は DB に触らない「純粋な関数」なので、単体でテストしやすい。
"""
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.config import JST

# 依頼種別の初期設定。着手に必要な項目（required_fields）は画面から変更できる。
DEFAULT_REQUEST_TYPES = {
    "data_extraction": {"name": "データ抽出", "required_fields": ["対象期間", "対象部門", "集計単位", "提出希望日時"]},
    "document": {"name": "資料作成", "required_fields": ["会議・用途", "参照データ", "提出希望日時"]},
    "account_setup": {"name": "PC・アカウント準備", "required_fields": ["入社日", "所属", "氏名", "提出希望日時"]},
    "inquiry": {"name": "問い合わせ", "required_fields": ["質問内容"]},
}

KANJI_KANA = r"一-龥々ァ-ヶー"
REQUEST_PHRASES = r"お願い|いただけますか|いただけると|ほしい|欲しい|もらえますか|教えて|ください"
DEFER_WORDS = r"確認して|あらためて|改めて|追って|別途"
REFERENCE_TO_MAIL = r"メールで|メールした|メールの件|メールでお願い"


@dataclass
class FieldValue:
    value: str | None          # None なら値なし
    confidence: str | None     # 'confirmed'（本文に明記） / 'inferred'（推測）
    evidence: str              # 根拠になった元の文
    deferred: bool = False     # 「後で連絡します」のように回答が保留された


@dataclass
class Classification:
    category: str              # new_request / no_action / suspicious / sent
    reason: str
    type_code: str | None = None
    title: str | None = None
    fields: dict[str, FieldValue] = field(default_factory=dict)


# ---------------------------------------------------------------- 日時の読み取り

def _sentence_of(text: str, start: int, end: int) -> str:
    """一致した位置を含む1文（行）を取り出す。根拠の表示に使う。"""
    left = max(text.rfind("\n", 0, start), text.rfind("。", 0, start)) + 1
    right_candidates = [p for p in (text.find("\n", end), text.find("。", end)) if p != -1]
    right = min(right_candidates) + 1 if right_candidates else len(text)
    return text[left:right].strip()


def parse_due(text: str, base: datetime) -> FieldValue | None:
    """本文から期限（〜まで）を読み取る。base はメッセージを受け取った日時。"""
    # ① 11/19（木）17時まで / 11/19 17:00まで
    m = re.search(r"(\d{1,2})/(\d{1,2})(?:（.）)?\s*(\d{1,2})(?::(\d{2})|時)\s*まで", text)
    if m:
        dt = datetime(base.year, int(m[1]), int(m[2]), int(m[3]), int(m[4] or 0), tzinfo=JST)
        return FieldValue(dt.isoformat(), "confirmed", _sentence_of(text, m.start(), m.end()))
    # ② 明日15:00まで / 明日（18日）の11時までに
    m = re.search(r"(明日|今日|本日)(?:（\d{1,2}日）)?の?\s*(\d{1,2})(?::(\d{2})|時)\s*まで", text)
    if m:
        day = base.date() + timedelta(days=1 if m[1] == "明日" else 0)
        dt = datetime(day.year, day.month, day.day, int(m[2]), int(m[3] or 0), tzinfo=JST)
        return FieldValue(dt.isoformat(), "confirmed", _sentence_of(text, m.start(), m.end()))
    # ③ 11/20（金）中 / 11/27（金）までに → 時刻がないので 18:00 と推測
    m = re.search(r"(\d{1,2})/(\d{1,2})(?:（.）)?\s*(?:中|まで)", text)
    if m:
        dt = datetime(base.year, int(m[1]), int(m[2]), 18, 0, tzinfo=JST)
        return FieldValue(dt.isoformat(), "inferred", _sentence_of(text, m.start(), m.end()))
    # ④ 今週中 → 金曜18:00と推測
    m = re.search(r"今週中", text)
    if m:
        friday = base.date() + timedelta(days=(4 - base.weekday()) % 7)
        dt = datetime(friday.year, friday.month, friday.day, 18, 0, tzinfo=JST)
        return FieldValue(dt.isoformat(), "inferred", _sentence_of(text, m.start(), m.end()))
    return None


# ---------------------------------------------------------------- 項目の抽出

def _labeled(text: str, label: str) -> FieldValue | None:
    """「対象部門：営業部」「集計単位は〜」のように、項目名つきで書かれた値を読む。"""
    m = re.search(rf"{label}\s*(?:は|：|:)\s*(.+?)(?:でお願い|で大丈夫|で|。|\n|$)", text)
    if not m:
        return None
    sentence = _sentence_of(text, m.start(), m.end())
    if re.search(DEFER_WORDS, sentence):
        return FieldValue(None, None, sentence, deferred=True)
    return FieldValue(m[1].strip(), "confirmed", sentence)


def _pattern(text: str, pattern: str, confidence: str = "confirmed") -> FieldValue | None:
    m = re.search(pattern, text)
    if not m:
        return None
    return FieldValue(m[1], confidence, _sentence_of(text, m.start(), m.end()))


def extract_fields(type_code: str, text: str, subject: str | None, base: datetime) -> dict[str, FieldValue]:
    """依頼種別ごとに、本文から分かる項目だけを返す。分からない項目は含めない。"""
    found: dict[str, FieldValue | None] = {}

    if type_code == "data_extraction":
        found["対象期間"] = _labeled(text, "対象期間") or _pattern(text, r"(\d{1,2}月分)")
        found["対象部門"] = (
            _labeled(text, "対象部門")
            or _pattern(text, rf"([{KANJI_KANA}]{{1,8}}部)が担当")
            or _pattern(text, rf"([{KANJI_KANA}]{{1,8}}部)の\d{{1,2}}月分")
        )
        found["集計単位"] = _labeled(text, "集計単位") or _pattern(
            text, rf"([{KANJI_KANA}]{{1,10}}別)で(?:見たい|お願い|大丈夫|ください)"
        )
    elif type_code == "document":
        found["会議・用途"] = _pattern(text, rf"\d{{1,2}}:\d{{2}}の([{KANJI_KANA}]{{1,10}}会議)") or _pattern(
            text, rf"([{KANJI_KANA}]{{1,10}}会議)"
        )
        found["参照データ"] = _pattern(text, r"『(.+?)』") or _pattern(text, r"(前回資料)")
    elif type_code == "account_setup":
        found["入社日"] = _pattern(text, r"(\d{1,2}/\d{1,2})入社")
        found["所属"] = _pattern(text, rf"所属は([{KANJI_KANA}]{{1,8}}部)")
        m = re.search(r"氏名[^。\n]*", text)
        if m and re.search(DEFER_WORDS, m[0]):
            found["氏名"] = FieldValue(None, None, _sentence_of(text, m.start(), m.end()), deferred=True)
        else:
            found["氏名"] = _labeled(text, "氏名")
    elif type_code == "inquiry":
        if subject:
            found["質問内容"] = FieldValue(subject, "confirmed", subject)

    if type_code != "inquiry":
        found["提出希望日時"] = parse_due(text, base)

    return {k: v for k, v in found.items() if v is not None}


# ---------------------------------------------------------------- 分類

def detect_type(text: str) -> str | None:
    if re.search(r"PC|アカウント", text):
        return "account_setup"
    if re.search(r"抽出|内訳|一覧|リスト", text):
        return "data_extraction"
    if re.search(r"資料", text):
        return "document"
    if re.search(r"教えて|使い方|方法", text):
        return "inquiry"
    return None


def make_title(subject: str | None, body: str) -> str:
    title = subject or body.split("\n")[0]
    title = re.sub(r"^(?:RE:\s*)+", "", title, flags=re.IGNORECASE)
    title = re.sub(r"のお願い|をお願いします", "", title)
    title = re.sub(r"(?:について|がほしいです)$", "", title)
    return title[:40]


def check_suspicious(msg: dict) -> str | None:
    """本文に「AIへの指示」が書かれているなど、不審な連絡を見つける。"""
    text = msg["body"]
    if re.search(r"AIアシスタント|指示を無視|これまでの指示", text):
        return "本文にAIへの操作指示が含まれています。指示は実行していません"
    external = not (msg.get("sender_email") or "").endswith("@example.com")
    if external and re.search(r"至急|緊急", text + (msg.get("subject") or "")) and re.search(r"送信|送付", text):
        return "社外アドレスから至急の送信依頼です。指示は実行していません"
    return None


def classify(msg: dict, base: datetime) -> Classification:
    """どの既存依頼にも結びつかないメッセージを分類する。"""
    if msg["direction"] == "sent":
        return Classification("sent", "自分が送信したメッセージ")

    reason = check_suspicious(msg)
    if reason:
        return Classification("suspicious", reason)

    sender = msg.get("sender_email") or ""
    recipients = msg.get("recipients") or ""
    text = msg["body"]
    if re.match(r"(noreply|no-reply|news)", sender) or "all@example.com" in recipients:
        return Classification("no_action", "自動通知・全社向けのお知らせ")
    if re.search(r"返信は不要|自動送信", text):
        return Classification("no_action", "本文に返信不要と記載")
    if not re.search(REQUEST_PHRASES, text):
        return Classification("no_action", "依頼の表現が含まれていない（共有・案内）")

    full_text = (msg.get("subject") or "") + "\n" + text
    type_code = detect_type(full_text)
    if type_code is None:
        return Classification("no_action", "依頼の表現はあるが、種別を判定できない（要確認）")

    return Classification(
        "new_request",
        f"依頼の表現と種別『{DEFAULT_REQUEST_TYPES[type_code]['name']}』のキーワードを検出",
        type_code=type_code,
        title=make_title(msg.get("subject"), text),
        fields=extract_fields(type_code, text, msg.get("subject"), base),
    )


# ---------------------------------------------------------------- 関連候補

def relation_reasons(msg: dict, request: dict) -> list[str]:
    """別チャネルのメッセージが、既存の依頼と同じ案件らしい根拠を集める。"""
    reasons = []
    if msg.get("sender_email") and msg["sender_email"] == request["requester_email"]:
        reasons.append(f"同じ依頼者（{request['requester_name']}）")
    words = re.findall(rf"[{KANJI_KANA}]{{3,}}", request["title"])
    for w in words:
        # 依頼名の語の一部（3文字以上）が本文に出てくるか
        hit = next((w[i:j] for i in range(len(w)) for j in range(len(w), i + 2, -1) if w[i:j] in msg["body"]), None)
        if hit:
            reasons.append(f"依頼名の語「{hit}」が本文に含まれる")
            break
    if re.search(REFERENCE_TO_MAIL, msg["body"]):
        reasons.append("メールで送った依頼への言及がある")
    return reasons


def is_relation_candidate(reasons: list[str]) -> bool:
    """同じ依頼者であることに加え、内容の根拠が1つ以上あれば候補にする。"""
    return any(r.startswith("同じ依頼者") for r in reasons) and len(reasons) >= 2

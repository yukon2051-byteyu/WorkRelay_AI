"""下書きのテンプレート（デモ用の固定の文面）。

本文に差し込むのは、抽出済みの項目・期限・依頼名だけ。
取り込んだメール本文に書かれた指示や文章を、そのまま下書きに写すことはしない
（不審な指示が下書きに紛れ込まないようにするため）。
同じ入力なら必ず同じ文面になる。将来は生成AI版に差し替えられるよう、入出力の形を固定している。
"""
from datetime import datetime

KIND_LABELS = {
    "due_adjust": "期限の相談",
    "confirm": "不足情報の確認",
    "answer": "問い合わせへの回答",
    "completion": "完了連絡",
}

# 確認文で、各項目を何と聞くか
FIELD_HINTS = {
    "対象期間": "いつからいつまでのデータが必要か",
    "対象部門": "全社か、特定の部門か",
    "集計単位": "明細のままか、部門別・月別などの合計か",
    "提出希望日時": "いつまでに必要か（会議で使う場合は、その日時も）",
    "会議・用途": "どの会議・用途で使うか",
    "参照データ": "参照してよいファイルや前回資料",
    "入社日": "入社日",
    "所属": "所属部署",
    "氏名": "対象者の氏名",
    "質問内容": "お困りの内容",
}

PLACEHOLDER = "【要記入"


def family_name(display_name: str | None) -> str:
    """『佐藤 健（営業部）』→『佐藤』"""
    if not display_name:
        return "ご担当者"
    return display_name.split("（")[0].split()[0]


def fmt(iso: str | None, now: datetime) -> str:
    if not iso:
        return "未設定"
    dt = datetime.fromisoformat(iso)
    if dt.date() == now.date():
        return f"本日{dt:%H:%M}"
    return f"{dt.month}/{dt.day}（{'月火水木金土日'[dt.weekday()]}）{dt:%H:%M}"


def due_adjust(to: str, me: str, meeting: str | None, committed: str | None, wish: str,
               free_minutes: int, effort: int | None, now: datetime) -> str:
    """期限の前倒しを受けたときの返信。作業時間が足りなければ速報版を提案する。"""
    head = f"{to}さん\n\nご連絡ありがとうございます。{me}です。\n"
    head += f"{meeting}の前倒し、承知しました。\n\n" if meeting else "前倒しの件、承知しました。\n\n"
    if effort and free_minutes < effort:
        return head + (
            f"確定版は{fmt(committed, now)}のお約束で準備していますが、"
            f"{fmt(wish, now)}までに確定版を仕上げるのは難しい状況です。\n\n"
            f"そこで、次の形でいかがでしょうか。\n"
            f"・速報版：{fmt(wish, now)}までにお送りします（主要な数字と変化のみ）\n"
            f"・確定版：予定どおり{fmt(committed, now)}までにお送りします\n\n"
            f"速報版で会議に足りるか、ご確認いただけますか。\n\n{me}"
        )
    return head + f"{fmt(wish, now)}までにお送りします。\n\n{me}"


def confirm(to: str, me: str, title: str, missing: list[str]) -> str:
    lines = "\n".join(f"{i}. {name}：{FIELD_HINTS.get(name, name)}" for i, name in enumerate(missing, 1))
    return (
        f"{to}さん\n\nご依頼ありがとうございます。{me}です。\n"
        f"「{title}」について、着手にあたり{len(missing)}点教えてください。\n\n{lines}\n\n"
        f"いただいた内容を確認して、作業時間と提出日をご連絡します。\nよろしくお願いします。\n\n{me}"
    )


def answer(to: str, me: str, title: str) -> str:
    """問い合わせへの回答。手順そのものは分からないので、要記入の欄を残す。"""
    return (
        f"{to}さん\n\nお問い合わせありがとうございます。{me}です。\n"
        f"{title}について、手順は以下のとおりです。\n\n"
        f"1. {PLACEHOLDER}：手順1】\n2. {PLACEHOLDER}：手順2】\n3. {PLACEHOLDER}：手順3】\n\n"
        f"ご不明な点があれば、お気軽にご連絡ください。\n\n{me}"
    )


def completion(to: str, me: str, title: str) -> str:
    return (
        f"{to}さん\n\n{me}です。\n「{title}」の対応が完了しました。\n\n"
        f"{PLACEHOLDER}：成果物の場所や内容】\n\nご確認をお願いします。\n\n{me}"
    )

"""Graph 形式の生データを、アプリ内の共通形式（正規化）に変換する。

メールと Teams では項目名が違う（receivedDateTime と createdDateTime など）。
ここで1つの形にそろえておけば、後の「依頼の抽出」は取り込み元を気にしなくてよい。
"""
import html
import json
import re
from datetime import datetime

from app.config import JST

USER_EMAIL = "aoki.yu@example.com"  # デモの利用者（架空）


def _to_iso(value: str) -> str:
    """日時文字列を +09:00 付きの ISO 形式にそろえる。"""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:  # 予定表の dateTime はタイムゾーンなしで届く
        dt = dt.replace(tzinfo=JST)
    return dt.astimezone(JST).isoformat()


def _html_to_text(content: str) -> str:
    """Teams の HTML 本文を、プレーンテキストにする。"""
    text = re.sub(r"</p>\s*<p>|<br\s*/?>", "\n", content)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def normalize_mail(raw: dict) -> dict:
    sender = raw["from"]["emailAddress"]
    body = raw["body"]["content"]
    if raw["body"].get("contentType") == "html":
        body = _html_to_text(body)
    return {
        "channel": "outlook",
        "external_id": raw["id"],
        "conversation_id": raw.get("conversationId"),
        "direction": "sent" if raw.get("parentFolder") == "sentitems" else "received",
        "sender_email": sender.get("address"),
        "sender_name": sender.get("name"),
        "recipients": json.dumps(
            [r["emailAddress"]["address"] for r in raw.get("toRecipients", [])],
            ensure_ascii=False,
        ),
        "subject": raw.get("subject"),
        "body": body,
        "received_at": _to_iso(raw["receivedDateTime"]),
    }


def normalize_teams(raw: dict) -> dict:
    user = raw["from"]["user"]
    sender_email = user.get("email")
    return {
        "channel": "teams",
        "external_id": raw["id"],
        "conversation_id": raw.get("chatId"),
        "direction": "sent" if sender_email == USER_EMAIL else "received",
        "sender_email": sender_email,
        "sender_name": user.get("displayName"),
        "recipients": json.dumps([], ensure_ascii=False),
        "subject": None,  # Teams チャットに件名はない
        "body": _html_to_text(raw["body"]["content"]),
        "received_at": _to_iso(raw["createdDateTime"]),
    }


def normalize_event(raw: dict) -> dict:
    is_work = "WorkRelay作業枠" in raw.get("categories", [])
    return {
        "external_id": raw["id"],
        "title": raw["subject"],
        "start_at": _to_iso(raw["start"]["dateTime"]),
        "end_at": _to_iso(raw["end"]["dateTime"]),
        "kind": "work" if is_work else "meeting",
    }

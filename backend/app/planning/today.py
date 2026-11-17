"""「今日やること」のカードを作り、優先順位をつける。

並び順は「期限が早い順」だけではない。次の要素を点数にして決める。
  - 条件変更（期限の前倒しなど）があるか         … 相談が遅れるほど相手も困る
  - 短い確認で相手の回答待ちと並行できるか       … 先に送れば自分の作業を止めずに済む
  - 確定期限までの近さ
  - 予定表の空き枠が足りるか
返信待ちのように「今は自分がやることがない」ものは、下の区分に回す。
点数のルールは固定なので、同じデータなら毎回同じ並びになる。利用者は並び順を変えられる。
"""
import json
import re
from datetime import datetime

from app.documents import service as doc_service
from app.drafts import service as draft_service
from app.intake import rules
from app.planning.slots import free_minutes_until, free_slots

SECTIONS = [
    ("now", "今すぐ対応"),
    ("today", "今日の空き時間で進める"),
    ("batch", "まとめて処理"),
    ("waiting", "返信待ち"),
    ("later", "後で確認"),
]
CHANNEL_LABEL = {"outlook": "メール", "teams": "Teams"}


# ---------------------------------------------------------------- 表示用の小道具

def who(name: str | None) -> str:
    """『佐藤 健（営業部）』→『営業』。部署がなければ『佐藤さん』。"""
    if not name:
        return "依頼者"
    m = re.search(r"（(.+?)部(?:長)?）", name)
    if m:
        return m[1]
    return name.split()[0] + "さん"


def fmt_dt(iso: str | None, now: datetime) -> str:
    if not iso:
        return "未設定"
    dt = datetime.fromisoformat(iso)
    if dt.date() == now.date():
        return f"今日{dt:%H:%M}"
    weekday = "月火水木金土日"[dt.weekday()]
    return f"{dt.month}/{dt.day}（{weekday}）{dt:%H:%M}"


def when_label(iso: str, now: datetime) -> str:
    dt = datetime.fromisoformat(iso)
    if dt.date() < now.date():
        return "昨夜" if dt.hour >= 17 else "昨日"
    return "今朝"


def _snippet(text: str, n: int = 60) -> str:
    text = text.replace("\n", " ")
    return text if len(text) <= n else text[:n] + "…"


def _due_urgency(due: str | None, now: datetime) -> int:
    if not due:
        return 0
    days = (datetime.fromisoformat(due).date() - now.date()).days
    return 30 if days <= 0 else 15 if days <= 2 else 0


# ---------------------------------------------------------------- カード

def _candidate_proposals(conn, req) -> list[dict]:
    """判断待ちの関連候補から、『もし同じ依頼なら何が変わるか』を読み取る（DBは変えない）。"""
    out = []
    for c in conn.execute(
        "SELECT rc.*, m.body, m.subject, m.channel, m.sender_name, m.received_at "
        "FROM relation_candidates rc JOIN messages m ON m.id = rc.message_id "
        "WHERE rc.request_id = ? AND rc.status = 'pending'", (req["id"],)):
        found = rules.extract_fields(req["type_code"], c["body"], c["subject"],
                                     datetime.fromisoformat(c["received_at"]))
        out.append({"candidate_id": c["id"], "message_id": c["message_id"], "channel": c["channel"],
                    "received_at": c["received_at"], "reasons": json.loads(c["reasons"]),
                    "values": {k: v.value for k, v in found.items() if v.value}})
    return out


def build_card(conn, req: dict, now: datetime, slots, events, last_checked: datetime) -> dict:
    rid = req["id"]
    fields = [dict(f) for f in conn.execute("SELECT * FROM request_fields WHERE request_id = ?", (rid,))]
    missing = [f["name"] for f in fields if f["state"] == "missing"]
    deferred = [f["name"] for f in fields if f["state"] == "deferred"]
    proposals = _candidate_proposals(conn, req)
    work_slots = [e for e in events if e["request_id"] == rid]
    msgs = [dict(m) for m in conn.execute(
        "SELECT m.id, m.channel, m.sender_name, m.received_at, m.body, rm.role FROM request_messages rm "
        "JOIN messages m ON m.id = rm.message_id WHERE rm.request_id = ? ORDER BY m.received_at", (rid,))]
    newly_ready = conn.execute(
        "SELECT at FROM request_history WHERE request_id = ? AND kind = 'status' AND new_value = '着手可能' "
        "ORDER BY at DESC LIMIT 1", (rid,)).fetchone()

    target = who(req["requester_name"])
    committed = req["committed_due"]
    effort = req["effort_minutes"]
    why: list[str] = []
    prep: list[dict] = []
    capacity = None
    section, score = "today", 0
    primary = {"label": "詳細を見る", "target": "detail"}

    # 判断待ちの候補から読み取った新しい希望期限（まだ確定していない）
    proposed_due = next((p["values"].get("提出希望日時") for p in proposals
                         if p["values"].get("提出希望日時") not in (None, req["requested_due"])), None)
    changed_due = req["requested_due"] if req["due_change_status"] == "needs_consult" else proposed_due
    change_msg = next((p for p in proposals if p["values"].get("提出希望日時") == proposed_due), None)
    if change_msg is None and req["due_change_status"] == "needs_consult":
        change_msg = next((m for m in reversed(msgs) if m["role"] == "change"), None)

    base_due = committed or req["requested_due"]

    if changed_due and base_due and changed_due < base_due:
        # ① 期限の前倒し
        deadline = datetime.fromisoformat(changed_due)
        free = free_minutes_until(slots, deadline)
        src = f"{when_label(change_msg['received_at'], now)}の{CHANNEL_LABEL[change_msg['channel']]}" if change_msg else "連絡"
        # 確定期限はカードの期限欄に出すので、理由文には書かない（同じ情報を二重に読ませない）
        why.append(f"{src}で期限の前倒しを依頼されました。")
        # 画面で数字を強調できるよう、空き時間と必要時間は数値でも渡す
        capacity = {"until": f"{deadline:%H:%M}", "free_minutes": free, "need_minutes": effort}
        if effort and free < effort:
            next_action = f"{target}に、速報版で足りるか確認する"
            why.append(f"{deadline:%H:%M}までの空きは{free}分、確定版には{effort}分必要です。")
        elif effort:
            next_action = f"{target}に、{fmt_dt(changed_due, now)}への前倒しを受けると返信する"
            why.append(f"{deadline:%H:%M}までの空きは{free}分で、必要な{effort}分を確保できます。")
        else:
            next_action = f"{target}に、前倒しに対応できるか返信する"
            prep.append({"label": "作業時間は未見積もり", "kind": "warn"})
        section, score = "now", 100
        primary = {"label": "返信案を確認", "target": "draft"}
    elif proposals:
        # ② 別チャネルの関連候補
        p = proposals[0]
        vals = "、".join(f"{k}『{v}』" for k, v in p["values"].items()) or "関連する内容"
        # 何を判断するのかが伝わる言い方にする（不足が埋まるなら「回答」、そうでなければ「関連する連絡」）
        fills_missing = any(k in missing for k in p["values"])
        kind = "既存の依頼への回答" if fills_missing else "既存の依頼に関する連絡"
        next_action = f"{target}からの連絡が、{kind}か確認する"
        why.append(f"{when_label(p['received_at'], now)}の{CHANNEL_LABEL[p['channel']]}に{vals}の連絡。"
                   f"同じ依頼なら{'不足が埋まる' if missing else '内容が変わる'}")
        section, score = "now", 80
        primary = {"label": "関連候補を確認", "target": "candidate"}
    elif req["status"] == "needs_info" and missing:
        # ③ 不足情報の確認（短い確認を先に送れば並行できる）
        if missing == ["提出希望日時"]:
            next_action = f"{target}に、期限を確認する"
        else:
            next_action = f"{target}に、{'・'.join(missing)}を確認する"
        why.append(f"不足情報{len(missing)}件。先に確認を送れば、回答待ちの間に他の作業を進められる")
        section, score = "now", 60
        primary = {"label": "確認文を作る", "target": "draft"}
    elif req["status"] in ("needs_info", "waiting_reply"):
        # ④ 相手の回答待ち
        rest = missing + deferred
        next_action = f"{target}からの回答を待つ（残り：{'・'.join(rest)}）"
        for name in deferred:
            ev = next(f for f in fields if f["name"] == name)["evidence_text"]
            why.append(f"{name}は後日連絡予定：「{_snippet(ev or '', 40)}」")
        if not deferred:
            why.append("確認を送信済み")
        section, score = "waiting", 0
        primary = {"label": "詳細を見る", "target": "detail"}
    elif req["type_code"] == "inquiry":
        # ⑤ 短い問い合わせは、まとめて処理
        next_action = f"{target}に、{req['title']}を回答する"
        why.append("急ぎの記載なし。手が空いたときにまとめて返信できる")
        section, score = "batch", 10
        primary = {"label": "返信案を確認", "target": "draft"}
    else:
        # ⑥ 着手可能な作業
        if newly_ready and newly_ready["at"] > last_checked.isoformat():
            why.append(f"{when_label(newly_ready['at'], now)}の返信で必要な情報がそろった")
        late_slots = [s for s in work_slots if committed and s["end_at"] > committed]
        if late_slots and effort:
            # 確定期限より後ろに作業枠がある（期限を前倒しで確定した後など）→ このままでは間に合わない
            s = late_slots[0]
            free = free_minutes_until(slots, datetime.fromisoformat(committed))
            next_action = f"{req['title']}を{fmt_dt(committed, now)}までに仕上げる段取りを決める"
            why.append(f"登録済みの作業枠（{s['start_at'][11:16]}–{s['end_at'][11:16]}）は確定期限より後です。")
            why.append(f"{datetime.fromisoformat(committed):%H:%M}までの空きは{free}分、必要な作業は{effort}分です。")
            capacity = {"until": f"{datetime.fromisoformat(committed):%H:%M}", "free_minutes": free, "need_minutes": effort}
            prep.append({"label": "作業枠が期限の後", "kind": "warn"})
            primary = {"label": "作業枠を見る", "target": "slots"}
            section, score = "now", 90
        elif work_slots:
            s = work_slots[0]
            next_action = f"{req['title']}を仕上げる"
            why.append(f"作業枠 {s['start_at'][11:16]}–{s['end_at'][11:16]} 登録済み")
            primary = {"label": "作業枠を見る", "target": "slots"}
        else:
            next_action = f"{req['title']}の作業枠を確保する"
            primary = {"label": "空き枠を確認", "target": "slots"}
            if effort:
                fit = [f"{a:%H:%M}–{b:%H:%M}" for a, b in slots if (b - a).total_seconds() / 60 >= effort]
                why.append(f"所要{effort}分。今日入る空き枠：{'、'.join(fit[:2]) if fit else 'なし'}")
        if section != "now":
            section, score = "today", 40

    # 期限の近さ・期限なし・作業時間
    # バッジは「押す前に分かると役立つ状態」だけにし、タイトルや理由と同じ内容は重ねない
    score += _due_urgency(base_due, now)
    title_says_due = "期限" in next_action or "提出希望日時" in next_action
    if not base_due and req["type_code"] != "inquiry" and not title_says_due:
        prep.append({"label": "期限を確認", "kind": "warn"})
    if effort is None and req["status"] != "waiting_reply":
        prep.append({"label": "作業時間は未見積もり", "kind": "info"})
    if proposals and primary["target"] != "candidate":
        prep.append({"label": "同一依頼の候補あり", "kind": "info"})
    # 押す前に分かると役立つ「準備済み」の状態（実際に下書きがあるときだけ）
    for d in draft_service.list_drafts(conn, rid):
        if d["status"] in ("sent", "discarded"):
            continue
        name = "確認文" if d["kind"] == "confirm" else "返信案"
        if d["needs_review"]:
            prep.insert(0, {"label": f"{name}の更新確認が必要", "kind": "warn"})
        else:
            label = f"{name}あり" + ("（保存済み）" if d["status"] == "saved" else "")
            prep.insert(0, {"label": label, "kind": "ok"})
    doc = doc_service.get_document(conn, rid) if req["type_code"] == "document" else None
    if doc:
        if doc["needs_review"]:
            prep.insert(1, {"label": "資料の更新確認が必要", "kind": "warn"})
        else:
            prep.insert(1, {"label": "資料下書きあり" if doc["content"]["complete"] else "資料下書きあり（要確認あり）",
                            "kind": "ok" if doc["content"]["complete"] else "warn"})

    evidence = [{"message_id": m["id"], "channel": m["channel"], "sender_name": m["sender_name"],
                 "received_at": m["received_at"], "role": m["role"], "snippet": _snippet(m["body"])}
                for m in msgs]
    evidence += [{"message_id": p["message_id"], "channel": p["channel"], "sender_name": req["requester_name"],
                  "received_at": p["received_at"], "role": "candidate", "snippet": ""} for p in proposals]

    secondary = []
    if proposals and primary["target"] != "candidate":
        secondary.append({"label": "同じ依頼か確認", "target": "candidate"})
    if primary["target"] != "slots" and section in ("now", "today"):
        secondary.append({"label": "作業枠を見る", "target": "slots"})
    secondary.append({"label": "後で確認", "target": "snooze"})

    return {
        "request_id": rid, "title": req["title"], "requester_name": req["requester_name"],
        "status": req["status"], "section": section, "score": score,
        "next_action": next_action, "why_now": why, "prep": prep,
        "due": {"requested": req["requested_due"], "committed": committed,
                "proposed": proposed_due, "change_status": req["due_change_status"]},
        "effort_minutes": effort, "evidence": evidence, "capacity": capacity,
        "has_document": doc is not None,
        "primary_action": primary, "secondary_actions": secondary,
    }


# ---------------------------------------------------------------- 並び順（利用者の変更を保存）

def _meta_list(conn, key: str) -> list[int]:
    row = conn.execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else []


def _save_meta_list(conn, key: str, values: list[int]) -> None:
    conn.execute("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                 (key, json.dumps(values)))
    conn.commit()


def set_manual_order(conn, request_ids: list[int]) -> None:
    _save_meta_list(conn, "manual_order", request_ids)


def set_snoozed(conn, request_id: int, snoozed: bool) -> None:
    ids = set(_meta_list(conn, "snoozed"))
    ids.add(request_id) if snoozed else ids.discard(request_id)
    _save_meta_list(conn, "snoozed", sorted(ids))


# ---------------------------------------------------------------- ホーム画面全体

def build_home(conn, source: str, now: datetime, last_checked: datetime) -> dict:
    events = [dict(e) for e in conn.execute(
        "SELECT * FROM events WHERE source = ? ORDER BY start_at", (source,))]
    slots = free_slots(events, now)
    reqs = [dict(r) for r in conn.execute(
        "SELECT * FROM requests WHERE source = ? AND status != 'done'", (source,))]
    cards = [build_card(conn, r, now, slots, events, last_checked) for r in reqs]

    snoozed = set(_meta_list(conn, "snoozed"))
    for c in cards:
        if c["request_id"] in snoozed:
            c["section"] = "later"
            c["secondary_actions"] = [{"label": "今日の一覧に戻す", "target": "unsnooze"}]

    manual = _meta_list(conn, "manual_order")
    rank = {rid: i for i, rid in enumerate(manual)}
    order = {key: i for i, (key, _) in enumerate(SECTIONS)}
    # 区分 → 利用者が決めた順 → 点数（高い順）→ 確定期限（早い順）
    cards.sort(key=lambda c: (order[c["section"]], rank.get(c["request_id"], 10_000), -c["score"],
                              c["due"]["committed"] or c["due"]["requested"] or "9999"))

    fyi = [dict(m) for m in conn.execute(
        "SELECT m.id, m.channel, m.sender_name, m.subject, m.body, m.received_at, c.category, c.reason "
        "FROM messages m JOIN message_classes c ON c.message_id = m.id "
        "WHERE m.source = ? AND c.category IN ('no_action', 'suspicious') AND m.received_at > ? "
        "ORDER BY c.category DESC, m.received_at", (source, last_checked.isoformat()))]
    for m in fyi:
        m["snippet"] = _snippet(m["body"])
        del m["body"]

    counts = dict(conn.execute(
        "SELECT c.category, COUNT(*) FROM messages m JOIN message_classes c ON c.message_id = m.id "
        "WHERE m.source = ? AND m.received_at > ? AND m.direction = 'received' GROUP BY c.category",
        (source, last_checked.isoformat())).fetchall())
    new_total = sum(counts.values())

    return {
        "now": now.isoformat(),
        "last_checked": last_checked.isoformat(),
        "summary": {
            "new_messages": new_total,
            "new_requests": counts.get("new_request", 0),
            "answers": counts.get("answer", 0),
            "changes": counts.get("change", 0) + counts.get("candidate", 0),
            "no_action": counts.get("no_action", 0),
            "suspicious": counts.get("suspicious", 0),
        },
        "sections": [{"key": k, "label": label, "items": [c for c in cards if c["section"] == k]}
                     for k, label in SECTIONS],
        "free_slots": [{"start": a.isoformat(), "end": b.isoformat(),
                        "minutes": int((b - a).total_seconds() // 60)} for a, b in slots],
        "events": [e for e in events if e["start_at"][:10] == now.date().isoformat()],
        "fyi": fyi,
    }

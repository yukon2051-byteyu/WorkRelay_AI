import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, Card, CalEvent, Candidate, CHANNEL, fmtDue, fmtTime, History, RequestDetail as Detail, statusClass } from "../api";
import { ChannelLabel, IconCheck, IconClose, IconLink, IconToday, IconWarn } from "../icons";
import { HelpTip } from "../help";
import DocumentPanel from "./DocumentPanel";
import DraftPanel from "./DraftPanel";
import SlotPlanner from "./SlotPlanner";

/** 原文はそのまま、指定した箇所だけ <mark> で軽く強調する */
function highlight(text: string, phrases: string[]): ReactNode[] {
  const list = phrases.filter(Boolean);
  if (!list.length) return [text];
  const re = new RegExp(`(${list.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.split(re).map((part, i) => (list.includes(part) ? <mark key={i} className="hl">{part}</mark> : part));
}

/** 判断に必要な文だけを抜き出す（強調箇所を含む文）。省いたところは「…」で明示する */
function excerpt(body: string, marks: string[]): { text: string; cut: boolean } {
  const sentences = body.split(/(?<=[。！？!?\n])/).map((s) => s.trim()).filter(Boolean);
  const keep = sentences.map((s, i) => (marks.some((m) => m && s.includes(m)) ? i : -1)).filter((i) => i >= 0);
  if (!keep.length) return { text: body, cut: false };
  let out = keep[0] > 0 ? "…" : "";
  keep.forEach((i, k) => {
    if (k > 0 && i !== keep[k - 1] + 1) out += "…";
    out += sentences[i];
  });
  if (keep[keep.length - 1] < sentences.length - 1) out += "…";
  return { text: out, cut: out.includes("…") };
}

type Props = {
  requestId: number;
  card?: Card;
  nowIso: string;
  events: CalEvent[];
  freeSlots: { start: string; end: string; minutes: number }[];
  focus?: string; // 開いたときに表示するタブ・箇所（candidate / evidence / slots / draft / document / progress など）
  version: number; // 外で何か変わったら再読み込みするための番号
  onChanged: (message: string) => void;
  onClose: () => void;
};

const ROLE: Record<string, string> = {
  origin: "依頼", answer: "回答", change: "条件変更", question: "自分の確認", related: "関連", candidate: "関連候補",
};

/** 詳細のタブ。最初の判断に必要なものは「概要」にまとめ、長い情報は各タブで確認する */
type Tab = "overview" | "messages" | "due" | "draft" | "document" | "progress";
const TAB_LABEL: Record<Tab, string> = { overview: "概要", messages: "連絡", due: "期限", draft: "下書き", document: "資料", progress: "進行" };
/** 一覧のボタンやツアーから渡される「開く場所」と、タブの対応 */
const TAB_OF: Record<string, Tab> = {
  detail: "overview", candidate: "overview", summary: "overview",
  evidence: "messages", "candidate-source": "messages",
  slots: "due", draft: "draft", document: "document",
  progress: "progress", status: "progress", fields: "progress",
};

export default function RequestDetail({ requestId, card, nowIso, events, freeSlots, focus, version, onChanged, onClose }: Props) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(TAB_OF[focus ?? ""] ?? "overview");
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<string | null>(focus && focus !== "detail" ? focus : null);
  const seenFocus = useRef<string | undefined>(focus);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.request(requestId).then((x) => alive && setD(x)).catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [requestId, version]);

  /** タブを開き、必要ならその中の箇所までスクロールする */
  const open = (sec: string) => {
    const t = TAB_OF[sec] ?? "overview";
    pendingScroll.current = sec === "detail" ? null : sec;
    if (t !== tab) setTab(t);
    else scrollToPending();
  };
  const scrollToPending = () => {
    const sec = pendingScroll.current;
    const pane = bodyRef.current?.closest(".detail-pane");
    if (!sec) { pane?.scrollTo({ top: 0 }); return; }
    const el = bodyRef.current?.querySelector(`[data-sec="${sec}"]`);
    if (el) {
      el.scrollIntoView({ block: "start" });
      pendingScroll.current = null;
    }
  };

  // 一覧のボタン（返信案を確認・空き枠を確認など）やツアーから、開く場所が変わったとき
  useEffect(() => {
    if (focus === seenFocus.current) return;
    seenFocus.current = focus;
    open(focus ?? "detail");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // タブを切り替えたら、選んだタブを横スクロールの表示範囲に収め、目的の箇所（なければ先頭）を表示する
  useLayoutEffect(() => {
    if (!d) return;
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (pendingScroll.current) scrollToPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, d]);

  if (error) return <div className="detail-body"><div className="error-box">依頼を読み込めませんでした：{error}</div></div>;
  if (!d) return <div className="detail-body muted" style={{ paddingTop: 20 }}>読み込み中…</div>;

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      onChanged(message);
    } catch (e) {
      onChanged(`操作に失敗しました：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pendingCands = d.candidates.filter((c) => c.status === "pending");
  const decidedCands = d.candidates.filter((c) => c.status !== "pending");
  // 判断待ちの候補の連絡にある期限（まだ依頼には反映していない）
  const candWithDue = pendingCands.find((c) => c.proposed_values["提出希望日時"]);
  const candDue = candWithDue ? { value: candWithDue.proposed_values["提出希望日時"], channel: candWithDue.message.channel } : null;
  const proposedDue = candDue?.value ?? null;
  const newDue = d.due_change_status === "needs_consult" ? d.requested_due : proposedDue;
  const tabs: Tab[] = ["overview", "messages", "due", "draft", ...(d.type_code === "document" ? ["document" as Tab] : []), "progress"];
  const msgIds = new Set(d.messages.map((m) => m.id));

  // 期限の要約（概要の「次にやること」の直下に置く）
  const dueLine = (
    <p className="due-line">
      {candDue ? (
        <span className="nw">{CHANNEL[candDue.channel]}での希望期限 <b>{fmtDue(candDue.value, nowIso)}</b><span className="tag-warn">（確認前）</span></span>
      ) : d.due_change_status === "needs_consult" ? (
        <span className="nw">希望期限 <b>{fmtDue(d.requested_due, nowIso)}</b><span className="tag-warn">（前倒しの相談中）</span></span>
      ) : !d.committed_due && d.requested_due ? (
        <span className="nw">希望期限 <b>{fmtDue(d.requested_due, nowIso)}</b>（未確定）</span>
      ) : null}
      {(candDue || d.due_change_status === "needs_consult") && <span className="sep">／</span>}
      {d.committed_due ? <span className="nw">確定期限 <b>{fmtDue(d.committed_due, nowIso)}</b></span> : !d.requested_due && !candDue ? <span className="nw">期限未設定</span> : null}
    </p>
  );
  const capacityLine = card?.capacity ? (
    <p className="capacity">
      <span className="nw">{card.capacity.until}までの空き{" "}
        <span className={card.capacity.need_minutes && card.capacity.free_minutes < card.capacity.need_minutes ? "short" : ""}>
          <b>{card.capacity.free_minutes}分</b>
        </span></span>
      {card.capacity.need_minutes && <><span className="sep">／</span><span className="nw">確定版に必要 <b>{card.capacity.need_minutes}分</b></span></>}
    </p>
  ) : !d.effort_minutes && (d.status === "ready" || d.status === "in_progress") ? (
    <p className="capacity">作業時間は未見積もり</p>
  ) : null;

  return (
    <div ref={bodyRef}>
      {/* ヘッダー：依頼名・依頼者・状態・閉じる だけに絞る（メールアドレスは「連絡」、依頼種別は「進行」で確認） */}
      <header className="detail-head">
        <div className="detail-head-row">
          <h2>{d.title}</h2>
          <span className={`badge ${statusClass(d.status)}`}>
            {d.status === "ready" && <IconCheck size={12} />}{d.status_label}
          </span>
          <button className="btn ghost icon" onClick={onClose} aria-label="詳細を閉じる" title="詳細を閉じる（Esc）">
            <IconClose />
          </button>
        </div>
        <div className="faint requester">{d.requester_name}</div>
        <div className="detail-tabs" role="tablist" aria-label="依頼の詳細" ref={tabsRef}>
          {tabs.map((t) => (
            <button key={t} id={`tab-${t}`} role="tab" className="detail-tab" aria-selected={tab === t} aria-controls={`panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => { pendingScroll.current = null; setTab(t); }}
              onKeyDown={(e) => {
                const i = tabs.indexOf(t);
                const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
                if (next) { e.preventDefault(); setTab(next); window.setTimeout(() => document.getElementById(`tab-${next}`)?.focus(), 0); }
              }}>
              {TAB_LABEL[t]}
              {t === "overview" && pendingCands.length > 0 && <span className="tab-dot warn" aria-label="判断待ちあり" />}
              {t === "draft" && d.drafts.some((x) => x.needs_review) && <span className="tab-dot warn" aria-label="更新確認あり" />}
            </button>
          ))}
        </div>
      </header>

      <div className="detail-body">
        {/* ================= 概要：次にやること・期限・判断に必要な根拠・判断ボタン ================= */}
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={tab !== "overview"}>
          <section className="block" data-sec="summary">
            <div className="next-box">
              <div className="label"><IconToday size={13} />{card ? "次にやること" : "期限"}<HelpTip id="next" label="次にやること" /></div>
              {card && <div className="text">{card.next_action}</div>}
              {dueLine}
              {capacityLine}
              {card && !card.capacity && card.why_now[0] && <p className="reason">{card.why_now[0]}</p>}
            </div>
          </section>

          {pendingCands.length > 0 && (
            <section className="block decide" data-sec="candidate">
              <h3>同じ依頼ですか？<span className="badge warn"><IconWarn size={12} />判断待ち</span><HelpTip id="candidate" label="同じ依頼の候補" /></h3>
              {pendingCands.map((c) => <Decide key={c.id} c={c} d={d} nowIso={nowIso} busy={busy} run={run} onMore={() => open("candidate-source")} />)}
            </section>
          )}

          {decidedCands.length > 0 && (
            <section className="block decided" data-sec="decided">
              {decidedCands.map((c) => (
                <p key={c.id} className="decided-line">
                  <IconCheck size={13} /> {CHANNEL[c.message.channel]}の連絡（{c.message.sender_name}・{fmtDue(c.message.received_at, nowIso)}）を
                  {c.status === "accepted" ? "同じ依頼としてつなぎました。確定期限は変えていません。" : "別の案件として扱いました。"}
                  <button className="link-btn" onClick={() => open(c.status === "accepted" ? "evidence" : "candidate-source")}>連絡で見る</button>
                  <button className="link-btn" onClick={() => open("progress")}>経緯を見る</button>
                </p>
              ))}
            </section>
          )}
        </div>

        {/* ================= 連絡：元の連絡と、関連候補の連絡（全文・判定理由） ================= */}
        <div role="tabpanel" id="panel-messages" aria-labelledby="tab-messages" hidden={tab !== "messages"}>
          <section className="block">
            <dl className="draft-meta">
              <dt>依頼者</dt><dd>{d.requester_name}　<span className="faint">{d.requester_email}</span></dd>
            </dl>
          </section>
          {d.candidates.some((c) => !msgIds.has(c.message.id)) && (
            <section className="block" data-sec="candidate-source">
              <h3>関連候補の連絡（同じ依頼かどうかの判断対象）</h3>
              {d.candidates.filter((c) => !msgIds.has(c.message.id)).map((c) => (
                <div key={c.id} className="cand-source">
                  <MessageView m={c.message} role="candidate" candidate marks={c.highlights} />
                  {/* デモは固定ルールで候補を出しているので「AIが」とは書かない */}
                  <div className="reasons-title">候補と判断した理由</div>
                  <ul className="reasons">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  {c.status === "pending" ? (
                    <div className="btn-row">
                      <button className="btn primary" disabled={busy} onClick={() => run(() => api.acceptCandidate(c.id), "同じ依頼としてつなぎました。確定期限はまだ変えていません")}>
                        <IconLink size={14} /> 同じ依頼としてつなぐ
                      </button>
                      <button className="btn" disabled={busy} onClick={() => run(() => api.rejectCandidate(c.id), "別の案件として扱います")}>別の案件として扱う</button>
                    </div>
                  ) : (
                    <p className="faint" style={{ margin: "6px 0 0" }}>判断済み：{c.status === "accepted" ? "同じ依頼としてつないだ" : "別の案件として扱った"}</p>
                  )}
                </div>
              ))}
            </section>
          )}
          <section className="block" data-sec="evidence">
            <h3>元の連絡（{d.messages.length}件）</h3>
            {d.messages.map((m) => <MessageView key={m.id} m={m} role={m.role ?? ""} />)}
          </section>
        </div>

        {/* ================= 期限：期限の内訳・作業枠の提案・今日の予定 ================= */}
        <div role="tabpanel" id="panel-due" aria-labelledby="tab-due" hidden={tab !== "due"}>
          <section className="block" data-sec="slots">
            <h3>期限と予定表<HelpTip id="slots" label="期限と予定表" /></h3>
            {/* 確定期限・現在の希望期限・候補の連絡にある期限・登録済みの作業枠を、別々の行で示す */}
            <dl className="due-grid">
              <dt>確定期限</dt>
              <dd className={d.committed_due ? "committed" : ""}>
                {fmtDue(d.committed_due, nowIso)}
                {d.committed_due && <span className="note">引き受け済み</span>}
              </dd>
              <dt>現在の希望期限</dt>
              <dd className={d.due_change_status === "needs_consult" ? "candidate" : ""}>
                {fmtDue(d.requested_due, nowIso)}
                {d.due_change_status === "needs_consult" && <span className="note">前倒しの相談中（確定期限はまだ変えていません）</span>}
              </dd>
              {candDue && (
                <>
                  <dt>変更候補</dt>
                  <dd className="candidate">
                    <IconWarn size={12} /> {fmtDue(candDue.value, nowIso)}
                    <span className="note">（{CHANNEL[candDue.channel]}・確認前）</span>
                  </dd>
                </>
              )}
              <dt>登録済みの作業枠</dt>
              <dd className={d.work_slots.length ? "slot" : ""}>
                {d.work_slots.length ? d.work_slots.map((s) => `${fmtTime(s.start_at)}–${fmtTime(s.end_at)}`).join("、") : "未登録"}
              </dd>
              <dt>必要な作業時間</dt>
              <dd>{d.effort_minutes ? `${d.effort_minutes}分` : "未見積もり"}</dd>
            </dl>

            {d.due_change_status === "needs_consult" && (
              <div className="notice warn" role="status">
                <span className="ico"><IconWarn /></span>
                <div>
                  <b>変更の相談が必要</b>：希望期限が {fmtDue(d.requested_due, nowIso)} に変わりました。
                  確認するまで、確定期限（{fmtDue(d.committed_due, nowIso)}）と作業枠はそのままです。
                  <div className="btn-row">
                    <button className="btn" disabled={busy} onClick={() => run(() => api.decideDue(d.id, "accept"), "確定期限を変更しました")}>
                      確定期限を {fmtDue(d.requested_due, nowIso)} に変更
                    </button>
                    <button className="btn" disabled={busy} onClick={() => run(() => api.decideDue(d.id, "keep"), "確定期限はそのままにしました")}>
                      {fmtDue(d.committed_due, nowIso)} のまま
                    </button>
                  </div>
                </div>
              </div>
            )}
            {pendingCands.length > 0 && proposedDue && (
              <div className="notice info">
                <span className="ico"><IconLink /></span>
                <div>候補の連絡を「同じ依頼」とつなぐと、希望期限の変更として記録されます。確定期限は、その後のあなたの判断まで変わりません。</div>
              </div>
            )}

            <SlotPlanner detail={d} nowIso={nowIso} onChanged={onChanged} onJump={open} />

            <div style={{ marginTop: 12 }}>
              <div className="faint" style={{ marginBottom: 4 }}>今日の予定（{d.work_slots.length ? "この依頼の作業枠を強調" : "空き時間は点線"}）</div>
              <DayTimeline events={events} freeSlots={freeSlots} requestId={d.id} deadline={newDue}
                deadlineLabel={candDue ? "変更候補の期限（確認前）" : "希望期限（前倒しの相談中）"} />
            </div>
          </section>
        </div>

        {/* ================= 下書き（タブを切り替えても、編集中の本文は保持する） ================= */}
        <div role="tabpanel" id="panel-draft" aria-labelledby="tab-draft" hidden={tab !== "draft"}>
          <section className="block" data-sec="draft">
            <h3>用意した下書き{d.drafts.some((x) => x.needs_review) && <span className="badge warn"><IconWarn size={12} />更新確認</span>}</h3>
            <DraftPanel detail={d} onChanged={onChanged} />
          </section>
        </div>

        {/* ================= 資料（資料作成の依頼のみ） ================= */}
        {d.type_code === "document" && (
          <div role="tabpanel" id="panel-document" aria-labelledby="tab-document" hidden={tab !== "document"}>
            <section className="block" data-sec="document">
              <h3>会議資料のたたき台{d.document?.needs_review && <span className="badge warn"><IconWarn size={12} />更新確認</span>}</h3>
              <DocumentPanel detail={d} onChanged={onChanged} />
            </section>
          </div>
        )}

        {/* ================= 進行：状態の操作・依頼の種類・着手に必要な項目・経緯 ================= */}
        <div role="tabpanel" id="panel-progress" aria-labelledby="tab-progress" hidden={tab !== "progress"}>
          <section className="block" data-sec="status">
            <dl className="draft-meta">
              <dt>依頼種別</dt><dd>{d.type_name}</dd>
              <dt>状態</dt><dd>{d.status_label}</dd>
            </dl>
            {/* 依頼の進行状態を、利用者が自分で進める（作業開始・完了・取り消し）。すべて履歴に残る */}
            <div className="status-actions">
              {d.status === "ready" && (
                <button className="btn ghost" disabled={busy} onClick={() => run(() => api.updateRequest(d.id, { status: "in_progress" }), "作業中にしました")}>作業を始める</button>
              )}
              {(d.status === "ready" || d.status === "in_progress") && (
                <button className="btn" disabled={busy} onClick={() => run(() => api.updateRequest(d.id, { status: "done" }), "完了にしました。今日の一覧から外れます")}>
                  <IconCheck size={13} /> 完了にする
                </button>
              )}
              {d.status === "done" && (
                <button className="btn ghost" disabled={busy} onClick={() => run(() => api.updateRequest(d.id, { status: "in_progress" }), "完了を取り消しました")}>完了を取り消す</button>
              )}
            </div>
          </section>
          <section className="block" data-sec="fields">
            <h3>着手に必要な項目</h3>
            <table className="fields">
              <tbody>
                {d.fields.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>
                      {f.state === "filled" ? (
                        <>
                          {f.name === "提出希望日時" && f.value ? fmtDue(f.value, nowIso) : f.value}{" "}
                          <span className={`badge ${f.confidence === "inferred" ? "warn" : ""}`}>{f.confidence === "inferred" ? "推測" : "明記"}</span>
                        </>
                      ) : f.state === "deferred" ? (
                        <span className="badge warn"><IconWarn size={12} />回答保留</span>
                      ) : (
                        <span className="badge warn"><IconWarn size={12} />不足</span>
                      )}
                      {f.evidence_text && <span className="ev">根拠：「{f.evidence_text}」</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="block" data-sec="progress">
            <h3>進行</h3>
            <Stages d={d} card={card} nowIso={nowIso} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** 概要の「同じ依頼ですか？」：連絡元・送信者・時刻、判断に必要な抜粋、期限への影響、判断ボタン */
function Decide({ c, d, nowIso, busy, run, onMore }: {
  c: Candidate; d: Detail; nowIso: string; busy: boolean;
  run: (fn: () => Promise<unknown>, message: string) => Promise<void>; onMore: () => void;
}) {
  const ex = excerpt(c.message.body, c.highlights);
  const impact = d.committed_due
    ? `同じ依頼としてつないでも、確定期限は${fmtDue(d.committed_due, nowIso)}のままです${d.work_slots.length ? "（登録済みの作業枠も変わりません）" : ""}。`
    : "同じ依頼としてつないでも、期限は自動では変わりません。";
  return (
    <div className="decide-item">
      <div className="msg candidate">
        <div className="msg-head">
          <ChannelLabel channel={c.message.channel} />
          <span className="from">{c.message.sender_name}</span>
          <span>{fmtDue(c.message.received_at, nowIso)}</span>
          <span className="badge">関連候補</span>
        </div>
        <blockquote className="msg-body excerpt">{highlight(ex.text, c.highlights)}</blockquote>
        {ex.cut && <div className="faint excerpt-note">抜粋です（「…」は省略した箇所）</div>}
      </div>
      <p className="impact"><IconLink size={12} /> {impact}期限を変えるかは、つないだ後に別に決めます。</p>
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={() => run(() => api.acceptCandidate(c.id), "同じ依頼としてつなぎました。確定期限はまだ変えていません")}>
          <IconLink size={14} /> 同じ依頼としてつなぐ
        </button>
        <button className="btn" disabled={busy} onClick={() => run(() => api.rejectCandidate(c.id), "別の案件として扱います")}>別の案件として扱う</button>
        <button className="link-btn decide-more" onClick={onMore}>原文と判定理由を見る</button>
      </div>
    </div>
  );
}

function MessageView({ m, role, candidate, marks = [] }: {
  m: Detail["messages"][number]; role: string; candidate?: boolean; marks?: string[];
}) {
  return (
    <div className={`msg${candidate ? " candidate" : ""}`}>
      <div className="msg-head">
        <ChannelLabel channel={m.channel} />
        <span className="from">{m.direction === "sent" ? "あなた" : m.sender_name}</span>
        <span>{fmtDue(m.received_at)}</span>
        {role && <span className="badge">{ROLE[role] ?? role}</span>}
      </div>
      {m.subject && <div className="msg-subject">{m.subject}</div>}
      <div className="msg-body">{highlight(m.body, marks)}</div>
    </div>
  );
}

/** 受信 → AIが準備 → 人が確認 → 対応済み（UiPath の「1件の仕事として追える」見せ方を参考） */
function Stages({ d, card, nowIso }: { d: Detail; card?: Card; nowIso: string }) {
  const msgById = new Map(d.messages.map((m) => [m.id, m]));
  const describe = (h: History) => {
    const src = h.message_id && msgById.get(h.message_id);
    const from = src ? `（${CHANNEL[src.channel]} ${fmtDue(src.received_at, nowIso)}）` : "";
    if (h.kind === "field" && h.new_value) return `${h.field}『${h.field === "提出希望日時" ? fmtDue(h.new_value, nowIso) : h.new_value}』を記入${from}`;
    if (h.kind === "field") return `${h.field}：${h.note ?? "変更"}${from}`;
    if (h.kind === "due") return `${h.field ?? "期限"}：${fmtDue(h.old_value, nowIso)} → ${fmtDue(h.new_value, nowIso)}${h.note ? `（${h.note}）` : ""}`;
    if (h.kind === "status") return `状態：${h.old_value} → ${h.new_value}${h.note ? `（${h.note}）` : ""}`;
    return `${h.note ?? h.kind}${from}`;
  };

  const received = d.messages.filter((m) => m.direction === "received");
  const aiItems = d.history.filter((h) => (h.actor === "ai" || h.actor === "system") && h.kind !== "received").map(describe);
  const userItems = d.history.filter((h) => h.actor === "user").map((h) => `${fmtDue(h.at, nowIso)}　${describe(h)}`);

  const judgements: string[] = [];
  d.candidates.filter((c) => c.status === "pending").forEach((c) =>
    judgements.push(`${CHANNEL[c.message.channel]}の連絡（${c.message.sender_name}）が同じ依頼か`));
  if (d.due_change_status === "needs_consult")
    judgements.push(`希望期限の変更（${fmtDue(d.committed_due, nowIso)} → ${fmtDue(d.requested_due, nowIso)}）を受けるか`);
  if (card?.due.proposed && !d.due_change_status)
    judgements.push(`前倒し（${fmtDue(card.due.proposed, nowIso)}）の相談：速報版で進めるか、期限を調整するか`);
  const missing = d.fields.filter((f) => f.state === "missing").map((f) => f.name);
  const deferred = d.fields.filter((f) => f.state === "deferred").map((f) => f.name);
  if (missing.length && d.status === "needs_info") judgements.push(`不足情報（${missing.join("・")}）の確認を送るか`);

  const stopped = missing.length || deferred.length
    ? { reason: `不足情報：${[...missing, ...deferred].join("・")}${deferred.length ? "（依頼者が後日回答予定）" : ""}`,
        resume: missing.length && d.status === "needs_info" ? "確認文を送る、または項目を手入力する" : "回答が届けば自動で項目に反映します" }
    : null;

  const stages = [
    { title: "受信", who: "Outlook / Teams", state: "done",
      items: received.map((m) => `${CHANNEL[m.channel]} ${fmtDue(m.received_at, nowIso)} ${m.sender_name}：${m.subject ?? m.body.slice(0, 24)}`) },
    { title: "AIが準備", who: "WorkRelay AI（固定ルール）", state: aiItems.length ? "done" : "todo", items: aiItems },
    { title: "人が確認", who: judgements.length ? "次はあなたが判断" : "判断待ちなし", state: judgements.length ? "current" : "done",
      items: judgements.length ? judgements.map((j) => `判断すること：${j}`) : ["判断待ちの項目はありません"] },
    { title: "対応済み", who: "あなたが行った操作", state: d.status === "done" ? "done" : userItems.length ? "partial" : "todo",
      items: userItems.length ? userItems : ["まだ操作はありません"] },
  ];

  return (
    <>
      <ol className="stages">
        {stages.map((s) => (
          <li key={s.title} className={`stage ${s.state === "done" ? "done" : s.state === "current" ? "current" : ""}`}>
            <span className="stage-dot">{s.state === "done" ? <IconCheck size={10} /> : s.state === "current" ? "!" : ""}</span>
            <div className="stage-title">{s.title}<span className="who">{s.who}</span></div>
            <ul>{s.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
          </li>
        ))}
      </ol>
      {stopped && (
        <div className="notice warn">
          <span className="ico"><IconWarn /></span>
          <div><b>止まっている理由</b>：{stopped.reason}<br /><b>再開するには</b>：{stopped.resume}</div>
        </div>
      )}
    </>
  );
}

/** 今日の予定・空き時間・期限の線を、時間順に並べる */
function DayTimeline({ events, freeSlots, requestId, deadline, deadlineLabel }: {
  events: CalEvent[]; freeSlots: { start: string; end: string; minutes: number }[]; requestId: number;
  deadline: string | null; deadlineLabel: string;
}) {
  type Row = { start: string; end?: string; label: string; cls: string };
  const rows: Row[] = [
    ...events.map((e) => ({
      start: e.start_at, end: e.end_at,
      label: e.title + (e.request_id === requestId ? "（この依頼の作業枠）" : e.kind === "work" ? "（作業枠）" : ""),
      cls: e.request_id === requestId ? "work" : "",
    })),
    ...freeSlots.map((s) => ({ start: s.start, end: s.end, label: `空き ${s.minutes}分`, cls: "free" })),
  ];
  if (deadline) rows.push({ start: deadline, label: deadlineLabel, cls: "deadline" });
  rows.sort((a, b) => a.start.localeCompare(b.start) || (a.cls === "deadline" ? -1 : 1));
  return (
    <div className="timeline">
      {rows.map((r, i) => (
        <div key={i} className={`tl-row ${r.cls}`}>
          <span className="tl-time">{fmtTime(r.start)}{r.end ? `–${fmtTime(r.end)}` : ""}</span>
          <span>{r.cls === "deadline" ? <><IconWarn size={12} /> {r.label}</> : r.label}</span>
        </div>
      ))}
    </div>
  );
}

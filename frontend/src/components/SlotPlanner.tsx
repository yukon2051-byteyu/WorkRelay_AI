import { useEffect, useRef, useState } from "react";
import { api, fmtDue, fmtTime, RequestDetail } from "../api";
import { IconCalendar, IconWarn } from "../icons";

type Props = { detail: RequestDetail; nowIso: string; onChanged: (m: string) => void; onJump: (sec: string) => void };
type Slot = { start: string; end: string };

/** 作業枠：候補の提示、足りないときの対応、予定表への登録（確認してから）と取り消し */
export default function SlotPlanner({ detail, nowIso, onChanged, onJump }: Props) {
  const p = detail.slot_plan;
  const [confirm, setConfirm] = useState<Slot | null>(null);
  const [effort, setEffort] = useState("");
  const open = ["needs_info", "waiting_reply", "ready", "in_progress"].includes(detail.status);

  const register = async (s: Slot) => {
    setConfirm(null);
    try {
      await api.createSlot(detail.id, s.start, s.end);
      onChanged(`作業枠を予定表に登録しました（${fmtDue(s.start, nowIso)}–${fmtTime(s.end)}）`);
    } catch (e) {
      onChanged(`登録できませんでした：${(e as Error).message}`);
    }
  };
  const unregister = async (id: number) => {
    try {
      await api.deleteSlot(id);
      onChanged("作業枠の登録を取り消しました");
    } catch (e) {
      onChanged(`取り消せませんでした：${(e as Error).message}`);
    }
  };
  const saveEffort = async () => {
    const n = Number(effort);
    if (!Number.isInteger(n) || n <= 0) { onChanged("作業時間は1以上の整数（分）で入力してください"); return; }
    try {
      await api.updateRequest(detail.id, { effort_minutes: n });
      onChanged(`作業時間を${n}分にしました`);
    } catch (e) {
      onChanged(`保存できませんでした：${(e as Error).message}`);
    }
  };
  const consult = async () => {
    try {
      await api.createDraft(detail.id, "schedule_consult");
      onChanged("期限を相談する返信案を作りました");
      window.setTimeout(() => onJump("draft"), 300);
    } catch (e) {
      onChanged(`返信案を作れませんでした：${(e as Error).message}`);
    }
  };

  return (
    <div className="planner">
      {detail.work_slots.length > 0 && (
        <div className="registered">
          {detail.work_slots.map((s) => (
            <div className="slot-row registered-row" key={s.id}>
              <span className="slot-time"><IconCalendar size={13} /> {fmtDue(s.start_at, nowIso)}–{fmtTime(s.end_at)}</span>
              <span className="faint">登録済み（デモ内の予定表）</span>
              <span style={{ flex: 1 }} />
              {open && <button className="btn ghost" onClick={() => unregister(s.id)}>登録を取り消す</button>}
            </div>
          ))}
        </div>
      )}

      {!open ? null : p.needs_effort ? (
        <div className="notice info">
          <div>
            作業時間が<b>未見積もり</b>のため、作業枠を提案できません。必要な時間を入力してください。
            <div className="btn-row">
              <label className="sr-only" htmlFor={`effort-${detail.id}`}>必要な作業時間（分）</label>
              <input id={`effort-${detail.id}`} className="input-num" type="number" min={1} step={5} placeholder="例：45"
                value={effort} onChange={(e) => setEffort(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEffort()} />
              <span>分</span>
              <button className="btn" onClick={saveEffort}>作業時間を保存</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {p.enough === false && (
            <div className="notice warn" role="status">
              <span className="ico"><IconWarn /></span>
              <div>
                <b>期限（{p.deadline_label}）までに作業時間が足りません</b>：空きは
                <b className="num"> {p.free_before_deadline}分</b>、必要なのは<b className="num"> {p.effort}分</b>です。選べる対応：
                <div className="options">
                  {p.options.map((o) => (
                    <div className="option" key={o.kind}>
                      <button className="btn" onClick={() => (o.kind === "consult" ? consult() : onJump(detail.document ? "document" : "draft"))}>{o.label}</button>
                      <span className="faint">{o.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {p.candidates.length > 0 && (
            <>
              <div className="faint" style={{ margin: "10px 0 4px" }}>作業枠の候補（所要{p.effort}分・早い順）</div>
              {p.candidates.map((c, i) => (
                <div className="slot-row" key={c.start}>
                  <span className="slot-time">{fmtDue(c.start, nowIso)}–{fmtTime(c.end)}</span>
                  {c.before_deadline
                    ? <span className="badge ok">期限前</span>
                    : <span className="badge warn"><IconWarn size={12} />期限後</span>}
                  <span style={{ flex: 1 }} />
                  {/* このセクションで目立たせるのは、期限に間に合う最初の候補だけ */}
                  <button className={`btn ${i === 0 && c.before_deadline ? "primary" : ""}`} onClick={() => setConfirm(c)}>
                    予定表に登録
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {confirm && (
        <SlotConfirm title={`【作業】${detail.title}`} slot={confirm} nowIso={nowIso}
          onOk={() => register(confirm)} onCancel={() => setConfirm(null)} />
      )}
    </div>
  );
}

/** 予定表に登録する前の確認：反映先・予定名・日時を見せてから、利用者が決める */
function SlotConfirm({ title, slot, nowIso, onOk, onCancel }: {
  title: string; slot: Slot; nowIso: string; onOk: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(".btn")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="overlay" role="presentation" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="予定表に作業枠を登録しますか？" ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2>予定表に作業枠を登録しますか？</h2>
        <p className="muted">デモでは、デモ内の予定表に登録します。実際の Outlook の予定表は変わりません。</p>
        <dl className="draft-meta">
          <dt>反映先</dt><dd>デモ内の予定表</dd>
          <dt>予定名</dt><dd>{title}</dd>
          <dt>日時</dt><dd>{fmtDue(slot.start, nowIso)}–{fmtTime(slot.end)}</dd>
        </dl>
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel}>キャンセル</button>
          <button className="btn primary" onClick={onOk}>予定表に登録する</button>
        </div>
      </div>
    </div>
  );
}

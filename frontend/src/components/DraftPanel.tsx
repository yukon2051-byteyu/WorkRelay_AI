import { useEffect, useRef, useState } from "react";
import { api, Draft, RequestDetail } from "../api";
import { ChannelLabel, IconCheck, IconWarn } from "../icons";

type Props = { detail: RequestDetail; onChanged: (message: string) => void };

const STATUS: Record<Draft["status"], { label: string; cls: string }> = {
  draft: { label: "未保存", cls: "" },
  saved: { label: "Outlookに下書き保存済み・未送信", cls: "cyan" },
  sent: { label: "送信済み", cls: "ok" },
  discarded: { label: "使わない", cls: "" },
};

/** 依頼詳細の「下書き」欄。確認・編集・コピー・保存・送信の記録を、利用者の操作で行う */
export default function DraftPanel({ detail, onChanged }: Props) {
  const drafts = detail.drafts;
  const canComplete = ["ready", "in_progress"].includes(detail.status) && !drafts.some((d) => d.kind === "completion");

  return (
    <>
      {drafts.length === 0 && <p className="muted" style={{ margin: 0 }}>この依頼で、今用意する返信の下書きはありません。</p>}
      {drafts.map((d) => <DraftCard key={d.id} draft={d} onChanged={onChanged} />)}
      {canComplete && (
        <button className="btn" style={{ marginTop: 8 }}
          onClick={async () => { await api.createDraft(detail.id, "completion"); onChanged("完了連絡の下書きを作りました"); }}>
          完了連絡の下書きを作る
        </button>
      )}
    </>
  );
}

function DraftCard({ draft, onChanged }: { draft: Draft; onChanged: (m: string) => void }) {
  const [body, setBody] = useState(draft.body);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirm, setConfirm] = useState<null | "save" | "sent">(null);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const timer = useRef<number | undefined>();
  const dirty = useRef(false);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const readOnly = draft.status === "sent";

  // サーバー側の本文が変わったとき（新しい案を使った等）だけ反映。入力中の内容は上書きしない
  useEffect(() => {
    if (!dirty.current) setBody(draft.body);
  }, [draft.body]);

  const flush = async (text: string) => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    setSaving("saving");
    try {
      await api.editDraft(draft.id, text);
      dirty.current = false;
      setSaving("saved");
    } catch {
      setSaving("error");
    }
  };

  // 入力が止まって0.8秒後に、編集内容を記録する（画面を移っても編集は残る）
  const onEdit = (text: string) => {
    setBody(text);
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(text), 800);
  };
  // 画面を閉じる・移るときに、記録前の編集が残っていれば記録する
  useEffect(() => () => { if (dirty.current) api.editDraft(draft.id, bodyRef.current).catch(() => {}); }, [draft.id]);

  const run = async (action: "copy" | "save" | "sent" | "discard" | "apply-suggestion", message: string) => {
    try {
      await flush(body);
      if (action === "copy") await navigator.clipboard.writeText(body).catch(() => {});
      await api.draftAction(draft.id, action);
      if (action === "apply-suggestion") dirty.current = false;
      onChanged(message);
    } catch (e) {
      onChanged(`操作に失敗しました：${(e as Error).message}`);
    }
  };

  const st = STATUS[draft.status];
  const isOutlook = draft.channel === "outlook";

  return (
    <div className="draft">
      <div className="draft-head">
        <span className="draft-kind">{draft.kind_label}</span>
        <ChannelLabel channel={draft.channel} />
        <span className={`badge ${st.cls}`}>{draft.status === "sent" && <IconCheck size={12} />}{st.label}</span>
        {draft.is_edited ? <span className="badge">編集済み</span> : null}
      </div>
      <div className="faint">{draft.generator}</div>

      {draft.needs_review && (
        <div className="notice warn" role="status">
          <span className="ico"><IconWarn /></span>
          <div>
            <b>更新内容の確認が必要</b>：下書きを作った後に、次の条件が変わりました。
            <ul className="changes">
              {draft.changes.map((c) => <li key={c.label}>{c.label}：{c.old} → <b>{c.new}</b></li>)}
            </ul>
            <button className="btn" onClick={async () => {
              await flush(body);
              await api.createDraft(draft.request_id, draft.kind);
              onChanged(draft.is_edited ? "新しい案を作りました（編集した本文はそのままです）" : "新しい条件で作り直しました");
            }}>新しい条件で作り直す</button>
          </div>
        </div>
      )}

      {draft.has_new_suggestion === 1 && (
        <div className="notice info">
          <div>
            編集した本文はそのまま残しています。新しい条件で作った案が別にあります。
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setShowSuggestion((v) => !v)}>{showSuggestion ? "新しい案を閉じる" : "新しい案を見る"}</button>
              <button className="btn" onClick={() => run("apply-suggestion", "新しい案に置き換えました")}>新しい案に置き換える</button>
            </div>
            {showSuggestion && <pre className="suggestion">{draft.generated_body}</pre>}
          </div>
        </div>
      )}

      <dl className="draft-meta">
        <dt>宛先</dt><dd>{draft.to_name}{isOutlook && <span className="faint">　{draft.to_email}</span>}</dd>
        {draft.subject && (<><dt>件名</dt><dd>{draft.subject}</dd></>)}
      </dl>
      <label className="sr-only" htmlFor={`draft-${draft.id}`}>下書きの本文</label>
      <textarea id={`draft-${draft.id}`} className="draft-body" value={body} readOnly={readOnly}
        onChange={(e) => onEdit(e.target.value)} onBlur={() => flush(body)} rows={Math.min(16, body.split("\n").length + 1)} />
      <div className="draft-foot">
        <span className="faint" aria-live="polite">
          {saving === "saving" ? "編集内容を記録中…" : saving === "saved" ? "編集内容を記録しました" : saving === "error" ? "編集内容を記録できませんでした" : ""}
        </span>
        {draft.has_placeholder && !readOnly && <span className="badge warn"><IconWarn size={12} />【要記入】が残っています</span>}
      </div>

      {!readOnly && (
        <div className="btn-row">
          {isOutlook ? (
            <>
              <button className="btn primary" onClick={() => setConfirm("save")}>Outlookに下書きを保存（デモ）</button>
              <button className="btn" onClick={() => run("copy", "本文をコピーしました")}>コピー</button>
            </>
          ) : (
            <button className="btn primary" onClick={() => run("copy", "本文をコピーしました。Teamsに貼り付けて送信してください")}>コピー（Teamsに貼り付け）</button>
          )}
          <button className="btn ghost" onClick={() => setConfirm("sent")}>送信済みにする</button>
          {draft.status !== "discarded" && <button className="btn ghost" onClick={() => run("discard", "この下書きは使わないことにしました")}>使わない</button>}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm === "save" ? "Outlookに下書きを保存しますか？" : "送信済みとして記録しますか？"}
          note={confirm === "save"
            ? "デモでは、デモ内のOutlook下書きに保存します。メールは送信されません。"
            : "実際の送信は Outlook / Teams で行ってください。デモでは、送信したことの記録だけを残します。"}
          draft={{ ...draft, body }}
          okLabel={confirm === "save" ? "下書きに保存する" : "送信済みとして記録する"}
          warn={draft.has_placeholder ? "【要記入】が残っています。内容を確認してください。" : null}
          onCancel={() => setConfirm(null)}
          onOk={async () => {
            const action = confirm;
            setConfirm(null);
            await run(action, action === "save" ? "Outlookの下書きに保存しました（未送信）" : "送信済みとして記録しました");
          }}
        />
      )}
    </div>
  );
}

/** 外部に反映する前の確認：対象（宛先・件名）と内容（本文）を見せてから、利用者が決める */
function ConfirmDialog({ title, note, draft, okLabel, warn, onOk, onCancel }: {
  title: string; note: string; draft: Draft; okLabel: string; warn: string | null; onOk: () => void; onCancel: () => void;
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted">{note}</p>
        <dl className="draft-meta">
          <dt>反映先</dt><dd><ChannelLabel channel={draft.channel} /></dd>
          <dt>宛先</dt><dd>{draft.to_name}　<span className="faint">{draft.to_email}</span></dd>
          {draft.subject && (<><dt>件名</dt><dd>{draft.subject}</dd></>)}
        </dl>
        <pre className="dialog-body">{draft.body}</pre>
        {warn && <div className="notice warn"><span className="ico"><IconWarn /></span><div>{warn}</div></div>}
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel}>キャンセル</button>
          <button className="btn primary" onClick={onOk}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

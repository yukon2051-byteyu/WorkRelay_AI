import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Card, fmtDue } from "../api";
import { IconCheck, IconWarn } from "../icons";

type Props = {
  card: Card;
  isTop: boolean; // 「まずこれ」（今すぐ対応の先頭）として強調するか
  selected: boolean;
  nowIso: string;
  canUp: boolean;
  canDown: boolean;
  onSelect: () => void;
  onAction: (target: string) => void;
  onMove: (dir: -1 | 1) => void;
};

/**
 * 「今日やること」の1件。
 * 最優先（isTop）は理由をすべて出し、塗りつぶしの主ボタンで目立たせる。
 * 通常の行は「行動タイトル・期限・理由1行・主操作」に絞り、補助操作は「⋯」メニューへ。
 */
export default function CardItem({ card, isTop, selected, nowIso, canUp, canDown, onSelect, onAction, onMove }: Props) {
  const act = (e: MouseEvent, target: string) => {
    e.stopPropagation(); // ボタンの操作で、行の選択が同時に起きないようにする
    onAction(target);
  };

  const buttons = (
    <div className="card-buttons">
      <button className={`btn ${isTop ? "primary" : "subtle"}`} onClick={(e) => act(e, card.primary_action.target)}>
        {card.primary_action.label}
      </button>
      {/* 資料の下書きが実際にあるときだけ、先頭カードに控えめな2つ目のボタンを出す */}
      {isTop && card.has_document && (
        <button className="btn subtle" onClick={(e) => act(e, "document")}>資料の下書きを見る</button>
      )}
      <MoreMenu card={card} canUp={canUp} canDown={canDown} onAction={onAction} onMove={onMove} />
    </div>
  );

  if (isTop) {
    // 先頭カード：左に「やること・理由」、右に「期限」とそのすぐ下の操作。判断してそのまま押せる配置
    return (
      <article className="card card-top" aria-selected={selected} aria-label={card.next_action} tabIndex={0}
        onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onSelect(); }}
        data-request-id={card.request_id}>
        <div className="card-main">
          <span className="first-label">まずこれ</span>
          <div className="card-action">{card.next_action}</div>
          <p className="card-reason">{card.why_now.join("")}</p>
          {card.prep.length > 0 && (
            <div className="card-chips">
              {card.prep.map((p) => (
                <span key={p.label} className={`badge ${p.kind === "warn" ? "warn" : p.kind === "ok" ? "ok" : "plain"}`}>
                  {p.kind === "warn" ? <IconWarn size={12} /> : p.kind === "ok" ? <IconCheck size={12} /> : null}
                  {p.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card-side">
          <DueView card={card} nowIso={nowIso} />
          {buttons}
        </div>
      </article>
    );
  }

  // 2件目以降：「行動名＋理由1行」「期限」「主ボタン」だけのコンパクトな行。補足は詳細と「⋯」へ
  const alerts = card.prep.filter((p) => p.kind === "warn");
  return (
    <article className="card card-row" aria-selected={selected} aria-label={card.next_action} tabIndex={0}
      onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onSelect(); }}
      data-request-id={card.request_id}>
      <div className="card-main">
        <div className="card-action">{card.next_action}</div>
        <div className="card-why one-line">
          {alerts.map((p) => (
            <span key={p.label} className="badge warn" style={{ marginRight: 6 }}><IconWarn size={12} />{p.label}</span>
          ))}
          {card.why_now[0]}
        </div>
      </div>
      <DueView card={card} nowIso={nowIso} />
      {buttons}
    </article>
  );
}

/** 期限の表示。前倒しの希望は「確定期限の取り消し」と誤読されないよう、2つの期限を並べて書く */
function DueView({ card, nowIso }: { card: Card; nowIso: string }) {
  const { due } = card;
  const wished = due.proposed ?? (due.change_status === "needs_consult" ? due.requested : null);
  if (wished) {
    return (
      <dl className="card-due two">
        <div className="due-wish" title="依頼者の希望期限（まだ確定していません）">
          <dt>希望</dt>
          <dd>{fmtDue(wished, nowIso)}<span className="due-note"><IconWarn size={12} />前倒しの相談</span></dd>
        </div>
        <div title="担当者が引き受けた確定期限">
          <dt>確定</dt>
          <dd>{fmtDue(due.committed, nowIso)}</dd>
        </div>
      </dl>
    );
  }
  if (due.committed && due.committed < nowIso) {
    // 実際に期限を過ぎた案件だけ、コーラルと「期限超過」の文字で示す
    return (
      <dl className="card-due">
        <div className="overdue"><dt>期限</dt><dd>{fmtDue(due.committed, nowIso)}<span className="due-note"><IconWarn size={12} />期限超過</span></dd></div>
      </dl>
    );
  }
  if (due.committed) {
    return <dl className="card-due"><div><dt>期限</dt><dd>{fmtDue(due.committed, nowIso)}</dd></div></dl>;
  }
  if (due.requested) {
    return <dl className="card-due"><div><dt>希望</dt><dd>{fmtDue(due.requested, nowIso)} <span className="faint">未確定</span></dd></div></dl>;
  }
  return <dl className="card-due"><div><dt>期限</dt><dd className="faint">未設定</dd></div></dl>;
}

/** 補助操作のメニュー。クリック・Enter・Space で開き、Esc や外側のクリックで閉じる */
function MoreMenu({ card, canUp, canDown, onAction, onMove }: {
  card: Card; canUp: boolean; canDown: boolean; onAction: (t: string) => void; onMove: (d: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const items: { label: string; run: () => void; disabled?: boolean }[] = [
    ...card.secondary_actions.map((a) => ({ label: a.label, run: () => onAction(a.target) })),
    { label: `元の連絡を見る（${card.evidence.length}件）`, run: () => onAction("evidence") },
    { label: "上へ移動", run: () => onMove(-1), disabled: !canUp },
    { label: "下へ移動", run: () => onMove(1), disabled: !canDown },
  ];

  return (
    <div className="menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        className="btn ghost icon more"
        aria-label="その他の操作"
        title="その他の操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          onKeyDown={(e) => {
            const list = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
            const i = list.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "Escape") { e.stopPropagation(); setOpen(false); ref.current?.querySelector<HTMLButtonElement>(".more")?.focus(); }
            if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); list[(i + 1) % list.length]?.focus(); }
            if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); list[(i - 1 + list.length) % list.length]?.focus(); }
          }}
        >
          {items.map((it) => (
            <button key={it.label} role="menuitem" className="menu-item" disabled={it.disabled}
              onClick={() => { setOpen(false); it.run(); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

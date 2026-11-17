import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type TourStep = {
  target: string; // 強調する場所（CSSセレクタ。複数に当たればまとめて囲む）
  title: string;
  body: string;
  prepare?: () => void; // 説明に必要な表示の切り替え（詳細を開く等）。データは変えない
};

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Tab で、ポップアップの外にフォーカスが出ないようにする */
function trapTab(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"));
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---------------------------------------------------------------- 初回の概要

export function IntroDialog({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(".btn.primary")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onSkip(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onSkip]);
  return (
    <div className="overlay intro-overlay" role="presentation">
      <div className="dialog intro" role="dialog" aria-modal="true" aria-labelledby="intro-title" ref={ref} onKeyDown={trapTab}>
        <button className="btn ghost icon intro-close" aria-label="閉じる" onClick={onSkip}>×</button>
        <div className="intro-tag">WorkRelay AI 公開デモ</div>
        <h2 id="intro-title">朝、やるべき仕事と下書きがそろう</h2>
        <p>
          WorkRelay AIは、メール・Teams・予定表から今日やるべき仕事を整理し、返信や資料の下書きを用意する業務アシスタントです。
          公開デモでは、架空の業務データで体験できます。
        </p>
        <p className="faint">デモの優先順位や下書きは固定ルールによるもので、生成AIは使っていません。</p>
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onSkip}>すぐに試す</button>
          <button className="btn primary" onClick={onStart}>1分で見る</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 画面ツアー

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6; // 強調枠の余白
const GAP = 14; // 強調枠とポップアップの間

function unionRect(selector: string): Rect | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((e) => e.offsetParent !== null);
  if (!els.length) return null;
  const rs = els.map((e) => e.getBoundingClientRect());
  const top = Math.min(...rs.map((r) => r.top)), left = Math.min(...rs.map((r) => r.left));
  const bottom = Math.max(...rs.map((r) => r.bottom)), right = Math.max(...rs.map((r) => r.right));
  return { top: top - PAD, left: left - PAD, width: right - left + PAD * 2, height: bottom - top + PAD * 2 };
}

/** ポップアップを、強調した場所に重ならず、画面に収まる位置へ置く（右→左→下→上の順に試す） */
function place(t: Rect, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth, vh = window.innerHeight, m = 12;
  const clampX = (x: number) => Math.max(m, Math.min(x, vw - w - m));
  const clampY = (y: number) => Math.max(m, Math.min(y, vh - h - m));
  const options = [
    { top: clampY(t.top), left: t.left + t.width + GAP, ok: t.left + t.width + GAP + w <= vw - m },
    { top: clampY(t.top), left: t.left - GAP - w, ok: t.left - GAP - w >= m },
    { top: t.top + t.height + GAP, left: clampX(t.left), ok: t.top + t.height + GAP + h <= vh - m },
    { top: t.top - GAP - h, left: clampX(t.left), ok: t.top - GAP - h >= m },
  ];
  const fit = options.find((o) => o.ok);
  return fit ? { top: fit.top, left: fit.left } : { top: vh - h - m, left: clampX(t.left) };
}

export function Tour({ steps, onFinish, onEnd }: {
  steps: TourStep[];
  onFinish: (action: "reply" | "list") => void; // 最後のボタン
  onEnd: () => void; // 途中で終了（Esc・終了ボタン）
}) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  const measure = useCallback(() => {
    const r = unionRect(step.target);
    setRect(r);
    if (r && pop.current) setPos(place(r, pop.current.offsetWidth, pop.current.offsetHeight));
  }, [step.target]);

  // ステップが変わったら：表示を切り替え → 対象を画面内に移動 → 位置を測ってから案内を出す
  useEffect(() => {
    let cancelled = false;
    setPos(null);
    step.prepare?.();
    const started = Date.now();
    const wait = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(step.target);
      if (!el && Date.now() - started < 3000) { window.setTimeout(wait, 80); return; }
      el?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
      window.setTimeout(() => { if (!cancelled) measure(); }, reduceMotion() ? 50 : 400);
    };
    wait();
    return () => { cancelled = true; };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (pos) pop.current?.querySelector<HTMLButtonElement>("[data-tour-next]")?.focus();
  }, [pos]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onEnd(); } };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true); // 一覧・詳細ペインのスクロールにも追従する
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, onEnd]);

  return (
    <div className="tour" role="presentation">
      <div className="tour-blocker" />
      {rect && <div className="tour-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />}
      <div ref={pop} className={`tour-pop${pos ? " shown" : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="tour-title" aria-describedby="tour-body" onKeyDown={trapTab}
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
        <div className="tour-count" aria-label={`全${steps.length}ステップ中 ${i + 1}`}>{i + 1} / {steps.length}</div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-buttons">
          <button className="btn ghost" onClick={onEnd}>終了</button>
          <span style={{ flex: 1 }} />
          <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>戻る</button>
          {last ? (
            <>
              <button className="btn" onClick={() => onFinish("list")}>一覧に戻る</button>
              <button className="btn primary" data-tour-next onClick={() => onFinish("reply")}>返信案を試す</button>
            </>
          ) : (
            <button className="btn primary" data-tour-next onClick={() => setI(i + 1)}>次へ</button>
          )}
        </div>
      </div>
    </div>
  );
}

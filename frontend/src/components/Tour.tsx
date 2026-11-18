import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, WheelEvent as ReactWheelEvent } from "react";
import type { Beat } from "../tour/story";
import { SCENE_COUNT } from "../tour/story";

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫"; // 場面番号（場面数より多めに用意）

/** Tab で、ポップアップの外にフォーカスが出ないようにする */
function trapTab(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), summary"));
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
        <h2 id="intro-title">青木さんの一日を体験</h2>
        <div className="intro-sub">目安5分・自分のペースで進めます</div>
        <p>
          WorkRelay AIは、メール・Teams・予定表から今日やるべき仕事を整理し、返信や資料の下書きを用意する業務アシスタントです。
          営業や経理から依頼を受ける青木さんの、ある水曜日を追いながら、システムが準備するところと、人が判断するところを紹介します。
        </p>
        <p className="faint">架空の業務データで動くデモです。優先順位や下書きは固定ルールによるもので、生成AIは使っていません。ツアー中の操作は、ツアー専用のデータで行います。</p>
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onSkip}>すぐに試す</button>
          <button className="btn primary" onClick={onStart}>デモツアーを始める</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 3分デモツアー

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const GAP = 20; // 注目エリアとポップアップの間（余裕を持たせて外に置く）
export type ExitDest = "free" | "reply" | "document" | "calendar" | "report" | "aborted";

function unionRect(selector: string): Rect | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((e) => e.getClientRects().length > 0);
  if (!els.length) return null;
  const rs = els.map((e) => e.getBoundingClientRect());
  const top = Math.min(...rs.map((r) => r.top)), left = Math.min(...rs.map((r) => r.left));
  const bottom = Math.max(...rs.map((r) => r.bottom)), right = Math.max(...rs.map((r) => r.right));
  // 画面の外にはみ出す部分は、見えている範囲に切り詰める
  const vt = Math.max(top, 0), vb = Math.min(bottom, window.innerHeight);
  return { top: vt - PAD, left: left - PAD, width: right - left + PAD * 2, height: Math.max(vb - vt, 24) + PAD * 2 };
}

/** ポップアップを、強調した場所に重ならず、画面に収まる位置へ置く（右→左→下→上の順に試す） */
function place(t: Rect | null, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth, vh = window.innerHeight, m = 12;
  if (!t) return { top: Math.max(m, (vh - h) / 2), left: Math.max(m, (vw - w) / 2) };
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

/** デモツアー。自動では進まず、「戻る」「次へ」「終了」で利用者が自分のペースで進める */
export function StoryTour({ beats, resetData, onExit }: {
  beats: Beat[];
  resetData: () => Promise<void>; // ツアー専用データを初期状態に戻す
  onExit: (dest: ExitDest) => void;
}) {
  const [idx, setIdx] = useState(-1);
  const [ready, setReady] = useState(false);
  const [more, setMore] = useState(false);
  const [canOpen, setCanOpen] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const runToken = useRef(0);
  const doneUpTo = useRef(-1); // ツアー専用データに act を適用済みの拍
  const beat = idx >= 0 ? beats[idx] : null;
  const final = beat?.kind === "ending"; // エンディング
  const centered = !!beat && beat.target === null; // 導入・エンディングは中央に表示し、注目枠は出さない
  // 同じ場面の中での現在地（「この場面の見どころ 2 / 4」）。「次へ」で何が変わったかを伝える
  const sceneTotal = beat ? beats.filter((b) => b.scene === beat.scene).length : 0;
  const sceneNo = beat ? beats.slice(0, idx + 1).filter((b) => b.scene === beat.scene).length : 0;

  const measure = useCallback(() => {
    if (!beat) return;
    const r = beat.target ? unionRect(beat.target) : null;
    setRect(r);
    if (pop.current) setPos(place(r, pop.current.offsetWidth, pop.current.offsetHeight));
  }, [beat]);

  /** k 番目の拍へ移る。戻るときはデータを初期状態に戻し、k までの操作をやり直す */
  const pendingTo = useRef<number | null>(null);
  const goTo = useCallback(async (k: number) => {
    if (k < 0 || k >= beats.length) return;
    if (pendingTo.current === k) return; // 「次へ」の連打で、同じ拍へ二重に移らない
    pendingTo.current = k;
    const token = ++runToken.current;
    setReady(false);
    setMore(false);
    setCanOpen(false);
    setActError(null);
    // データ操作や表示の切り替えに失敗しても、ツアーは止めずに続ける（失敗したことは説明に出す）
    try {
      // 戻り先より後ろのデータ操作がすでに行われているときだけ、初期状態からやり直す
      const needReset = beats.slice(k + 1, doneUpTo.current + 1).some((b) => b.act);
      if (needReset) {
        await resetData();
        doneUpTo.current = -1;
      }
      for (let j = doneUpTo.current + 1; j <= k; j++) {
        if (token !== runToken.current) return;
        await beats[j].act?.();
        doneUpTo.current = j;
      }
    } catch (e) {
      console.error("tour act failed", e);
      setActError(`デモの操作を再現できませんでした（${(e as Error).message}）`);
      doneUpTo.current = k;
    }
    if (token !== runToken.current) return;
    setIdx(k);
    try {
      await beats[k].view?.();
    } catch (e) {
      console.error("tour view failed", e);
    }
    // 対象が描かれるまで待つ → 画面内へ移動 → 位置を測ってから案内を出す
    const target = beats[k].target;
    const started = Date.now();
    while (target && !document.querySelector(target) && Date.now() - started < 4000) {
      await new Promise((r) => setTimeout(r, 80));
    }
    if (token !== runToken.current) return;
    // 注目エリアを画面内へ移し、スクロールが止まって位置が落ち着いてから案内を出す。
    // 依頼詳細が自分の欄へスクロールするのと重なって、注目エリアが画面外に外れることがあるので、
    // 落ち着いた後に画面内かを確かめ、外れていればもう一度スクロールする（最大3回）
    const waitStable = async () => {
      let prev = "", stable = 0;
      const until = Date.now() + 2000;
      while (Date.now() < until && stable < 2) {
        await new Promise((r) => setTimeout(r, 100));
        const el = target ? document.querySelector<HTMLElement>(target) : null;
        const r = el?.getBoundingClientRect();
        const key = r ? `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.height)}` : "none";
        stable = key === prev ? stable + 1 : 0;
        prev = key;
      }
    };
    const inView = () => {
      const r = target ? document.querySelector<HTMLElement>(target)?.getBoundingClientRect() : null;
      return !r || (r.top >= 0 && r.top < window.innerHeight - 40);
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (target) document.querySelector<HTMLElement>(target)?.scrollIntoView({ block: "center", behavior: reduceMotion() || attempt > 0 ? "auto" : "smooth" });
      await waitStable();
      if (token !== runToken.current) return;
      if (inView()) break;
    }
    if (token !== runToken.current) return;
    pendingTo.current = null;
    setReady(true);
  }, [beats, resetData]);

  useEffect(() => { goTo(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) measure(); }, [ready, more, canOpen, measure]);
  // 最初の拍では「次へ」、最後の案内では「自由に試す」にフォーカスを置く（キーボードだけで操作できるように）
  useEffect(() => {
    if (ready && (idx === 0 || final)) pop.current?.querySelector<HTMLButtonElement>("[data-tour-focus]")?.focus();
  }, [ready, idx, final]);

  /** ツアー中のマウスホイール：幕の下の画面をスクロールさせ、気になったところを読めるようにする */
  const onWheel = (e: ReactWheelEvent) => {
    const under = document.elementsFromPoint(e.clientX, e.clientY)
      .find((el) => !el.closest(".tour") && el instanceof HTMLElement) as HTMLElement | undefined;
    let el: HTMLElement | null = under ?? null;
    while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    el?.scrollBy({ top: e.deltaY });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onExit("aborted"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); goTo(idx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); goTo(idx - 1); }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [idx, goTo, measure, onExit]);

  return (
    <div className="tour" role="presentation" onWheel={onWheel}>
      <div className="tour-blocker" />
      {ready && rect && <div className="tour-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />}
      {centered && ready && <div className="tour-dim" />}
      <div ref={pop} className={`tour-pop story${centered ? " final" : ""}${final ? " ending" : ""}${ready && pos ? " shown" : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="tour-scene" aria-describedby="tour-text" onKeyDown={trapTab}
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
        {beat && (
          <>
            <div className="tour-head">
              <span id="tour-scene" className="tour-scene"><span className="tour-time">{beat.time}</span>　{CIRCLED[beat.scene - 1]} {beat.sceneName}</span>
              <span className="tour-count">場面 {beat.scene} / {SCENE_COUNT}</span>
            </div>
            {sceneTotal > 1 && (
              <div className="tour-step" aria-label={`この場面の見どころ ${sceneTotal}か所中 ${sceneNo}か所目`}>
                この場面の見どころ {sceneNo} / {sceneTotal}
                <span className="tour-dots" aria-hidden="true">
                  {Array.from({ length: sceneTotal }, (_, i) => <span key={i} className={i < sceneNo ? "on" : ""} />)}
                </span>
              </div>
            )}

            {final ? (
              <div id="tour-text" className="final-body">
                <h2>デモツアーは終了です</h2>
                <p>{beat.text}</p>
                <p className="faint">
                  Microsoft 365 との実連携は未実装・未検証です。ツアーで紹介した接続手順は導入時の想定です。詳しくは、接続設定の「実際の業務で使うには」にまとめています。
                </p>
                <div className="btn-row">
                  <button className="btn primary" data-tour-focus onClick={() => onExit("free")}>自由に試す</button>
                </div>
                <div className="final-links" aria-label="気になった機能を開く">
                  <button className="btn" onClick={() => onExit("reply")}>返信案を見る</button>
                  <button className="btn" onClick={() => onExit("document")}>資料の下書きを見る</button>
                  <button className="btn" onClick={() => onExit("calendar")}>予定表を見る</button>
                  <button className="btn" onClick={() => onExit("report")}>改善レポートを見る</button>
                </div>
              </div>
            ) : (
              <>
                <p id="tour-text" className="tour-text">{beat.text}</p>
                {beat.detail && (
                  <details className="tour-more" open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
                    <summary>詳しく見る</summary>
                    <p>{beat.detail}</p>
                  </details>
                )}
                {beat.can && (
                  <details className="tour-more" open={canOpen} onToggle={(e) => setCanOpen((e.target as HTMLDetailsElement).open)}>
                    <summary>この画面でできること</summary>
                    <ul>{beat.can.map((c) => <li key={c}>{c}</li>)}</ul>
                  </details>
                )}
              </>
            )}

            <div className="tour-buttons">
              <button className="btn" disabled={idx <= 0} onClick={() => goTo(idx - 1)}>戻る</button>
              {!final && <button className="btn primary" data-tour-focus onClick={() => goTo(idx + 1)}>次へ</button>}
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => onExit("aborted")}>終了</button>
            </div>
            {actError && <div className="notice warn" role="status" style={{ marginTop: 8 }}>{actError}</div>}
            {!ready && <div className="faint tour-loading" aria-live="polite">準備中…</div>}
          </>
        )}
      </div>
    </div>
  );
}

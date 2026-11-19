import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, WheelEvent as ReactWheelEvent } from "react";
import type { Beat } from "../tour/story";
import { CHAPTERS, SCENE_COUNT, SCENE_META } from "../tour/story";
import AokiAvatar from "./AokiAvatar";

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮"; // 場面番号（場面数より多めに用意）

/** Tab で、ポップアップの外にフォーカスが出ないようにする */
function trapTab(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), summary"));
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** 角の丸い四角の輪郭（SVG のパス）。幕に穴を開けるのに使う */
const roundRect = (r: Rect, k = 8) =>
  `M${r.left + k} ${r.top}H${r.left + r.width - k}Q${r.left + r.width} ${r.top} ${r.left + r.width} ${r.top + k}` +
  `V${r.top + r.height - k}Q${r.left + r.width} ${r.top + r.height} ${r.left + r.width - k} ${r.top + r.height}` +
  `H${r.left + k}Q${r.left} ${r.top + r.height} ${r.left} ${r.top + r.height - k}V${r.top + k}Q${r.left} ${r.top} ${r.left + k} ${r.top}Z`;

/** ポップアップを、強調した場所（と、サイドバーで照らした項目）に重ならず、画面に収まる位置へ置く（右→左→下→上の順に試す） */
function place(t: Rect | null, w: number, h: number, avoid: Rect | null = null): { top: number; left: number } {
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
  // サイドバーで照らした項目に重なる候補は、横へずらして避ける（ずらせなければ次の候補へ）
  const clear = (o: { top: number; left: number }) => !avoid || !overlaps({ top: o.top, left: o.left, width: w, height: h }, avoid);
  const shifted = options.map((o) => (clear(o) || !avoid ? o : { ...o, left: avoid.left + avoid.width + m }))
    .map((o) => ({ ...o, ok: o.ok && o.left + w <= vw - m && !(t && overlaps({ top: o.top, left: o.left, width: w, height: h }, t)) }));
  const fit = shifted.find((o) => o.ok && clear(o)) ?? options.find((o) => o.ok);
  // どの候補でも、最後に画面内へ収める（照らす場所が画面の外にあるときや、狭い画面でもはみ出さない）
  return fit ? { top: clampY(fit.top), left: clampX(fit.left) } : { top: Math.max(m, vh - h - m), left: clampX(t.left) };
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
  const [navRect, setNavRect] = useState<Rect | null>(null); // 表示中の画面にあたるサイドバーの項目
  const [actError, setActError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const runToken = useRef(0);
  const doneUpTo = useRef(-1); // ツアー専用データに act を適用済みの拍
  const beat = idx >= 0 ? beats[idx] : null;
  const final = beat?.kind === "ending"; // エンディング
  const isBreak = beat?.kind === "break"; // 小休止（場面には数えない）
  const breakTotal = beats.filter((b) => b.kind === "break").length;
  const breakNo = beats.slice(0, idx + 1).filter((b) => b.kind === "break").length;
  const centered = !!beat && beat.target === null; // 導入・エンディングは中央に表示し、注目枠は出さない
  // 同じ場面の中での現在地（「この場面の見どころ 2 / 4」）。「次へ」で何が変わったかを伝える
  // 場面単位の移動（「前の場面へ」「次の場面へ」）。小休止は、それだけで1つの区切りとして扱う
  const unitKey = (b: Beat, i: number) => (b.kind === "break" ? `break-${i}` : `scene-${b.scene}`);
  const unitStarts = beats.map((b, i) => i).filter((i) => i === 0 || unitKey(beats[i], i) !== unitKey(beats[i - 1], i - 1));
  const curUnit = unitStarts.filter((s) => s <= idx).length - 1; // 今いる区切りの番号
  const prevScene = curUnit > 0 ? unitStarts[curUnit - 1] : -1;
  const nextScene = curUnit >= 0 && curUnit + 1 < unitStarts.length ? unitStarts[curUnit + 1] : -1;
  // 場面を選んで移動するメニュー（どの場面へも、順番に関係なく移れる）
  const [pickOpen, setPickOpen] = useState(false);
  // 「この画面で試してみる」：説明をいったん隠して、画面を自由に操作できるようにする（操作はツアー専用データ）
  const [trying, setTrying] = useState(false);
  const startTry = () => { setPickOpen(false); setTrying(true); };
  /** ツアーに戻る：試した操作を取り消し、データと画面をこの拍の状態に作り直してから説明を再開する */
  const endTry = () => { setTrying(false); goTo(idx, true); };
  const unitLabel = (i: number) => {
    const b = beats[i];
    return b.kind === "break" ? `小休止：${b.sceneName}` : `${CIRCLED[b.scene - 1]} ${b.time}　${b.sceneName}`;
  };
  const jumpTo = (k: number) => { setPickOpen(false); if (k >= 0) goTo(k); };
  const inScene = (b: Beat) => !!beat && b.scene === beat.scene && b.kind !== "break";
  const sceneTotal = beat && !isBreak ? beats.filter(inScene).length : 0;
  const sceneNo = beat && !isBreak ? beats.slice(0, idx + 1).filter(inScene).length : 0;

  const measure = useCallback(() => {
    if (!beat) return;
    const r = beat.target ? unionRect(beat.target) : null;
    // 照らした場所がどの画面のものか分かるよう、サイドバーの該当項目も照らす（照らす場所がサイドバーの中なら重ねない）
    const nav = r ? unionRect('.nav-item[aria-current="page"]') : null;
    const inNav = !!beat.target && Array.from(document.querySelectorAll(beat.target)).some((e) => e.closest(".nav"));
    const n = nav && r && !inNav ? nav : null;
    setRect(r);
    setNavRect(n);
    if (pop.current) setPos(place(r, pop.current.offsetWidth, pop.current.offsetHeight, n));
  }, [beat]);

  /** k 番目の拍へ移る。戻るときはデータを初期状態に戻し、k までの操作をやり直す */
  const pendingTo = useRef<number | null>(null);
  const goTo = useCallback(async (k: number, rebuild = false) => {
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
      // 「この画面で試してみる」のあとは、利用者の操作を取り消すため、必ず初期状態からやり直す
      const needReset = rebuild || beats.slice(k + 1, doneUpTo.current + 1).some((b) => b.act);
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
      if (trying) {
        if (e.key === "Escape" && !document.querySelector(".overlay")) { e.stopPropagation(); e.preventDefault(); endTry(); }
        return;
      }
      if (e.key === "Escape" && pickOpen) { e.stopPropagation(); e.preventDefault(); setPickOpen(false); }
      else if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onExit("aborted"); }
      else if (pickOpen) return; // メニューを開いている間は、矢印キーで拍を動かさない
      else if (e.key === "ArrowRight" && e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (nextScene >= 0) goTo(nextScene); }
      else if (e.key === "ArrowLeft" && e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (prevScene >= 0) goTo(prevScene); }
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
  }, [idx, goTo, measure, onExit, prevScene, nextScene, pickOpen, trying]); // eslint-disable-line react-hooks/exhaustive-deps

  // 試し中：幕・注目枠・説明は出さず、画面の下に小さな帯だけを出す（帯以外は通常の画面として操作できる）
  if (trying) {
    return (
      <div className="tour trying" role="presentation">
        <div className="try-bar" role="status">
          <span className="try-icon" aria-hidden="true">🧪</span>
          <span>
            <b>試し中</b>：この画面を自由に操作できます。操作はツアー専用のデータで行い、あなたのデモには影響しません。
            ツアーに戻ると、この場面の状態に戻ります。
          </span>
          <button className="btn tbtn primary cta" onClick={endTry}>ツアーに戻る</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tour" role="presentation" onWheel={onWheel}>
      <div className="tour-blocker" />
      {ready && rect && (
        <>
          {/* 幕：照らす場所（とサイドバーの該当項目）だけ穴を開けて、周りを軽く暗くする */}
          <svg className="tour-scrim" width="100%" height="100%" aria-hidden="true">
            <path fillRule="evenodd"
              d={`M0 0H${window.innerWidth}V${window.innerHeight}H0Z${roundRect(rect)}${navRect ? roundRect(navRect) : ""}`} />
          </svg>
          <div className="tour-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
          {navRect && <div className="tour-spot nav-spot" style={{ top: navRect.top, left: navRect.left, width: navRect.width, height: navRect.height }} />}
        </>
      )}
      {centered && ready && <div className="tour-dim" />}
      <div ref={pop} className={`tour-pop story${final ? " ending" : ""}${isBreak ? " break" : ""}${beat?.kind === "intro" ? " welcome" : ""}${centered ? " big" : " compact"}${ready && pos ? " shown" : ""}`} role="dialog" aria-modal="true"
        aria-labelledby="tour-title" aria-describedby="tour-text" onKeyDown={trapTab}
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}>
        {beat && (() => {
          const meta = SCENE_META[beat.scene];
          const badge = isBreak ? "☕ 小休止" : meta.badge;
          const sp = badge.indexOf(" ");
          const chapter = meta.chapter;
          const welcome = beat.kind === "intro";
          const normal = !welcome && !isBreak && !final;
          // 1〜4の進捗。エンディングは矢印型（終わったチャプターはミント）、小休止は現在のチャプターに✓
          const progress = (
            <ol className={`chapters${final ? " arrows" : ""}`} aria-label={`チャプター ${chapter + 1} / ${CHAPTERS.length}：${CHAPTERS[chapter]}`}>
              {CHAPTERS.map((c, i) => {
                const st = i < chapter ? "done" : i === chapter ? "current" : "todo";
                return (
                  <li key={c} className={`chapter ${st}`} title={`${i + 1}. ${c}`} aria-current={st === "current" ? "step" : undefined}>
                    {i + 1}{isBreak && st === "current" && <span aria-hidden="true"> ✓</span>}
                  </li>
                );
              })}
            </ol>
          );
          return (
          <>
            {/* 小休止・エンディングの紙吹雪（カードの外まで舞う。動きを減らす設定では出さない） */}
            {(isBreak || final) && ready && <div className="confetti" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <i key={i} />)}</div>}

            {/* 帯：青木さん＋白い時刻バッジ（右上の×で終了） */}
            <div className="tour-band">
              <AokiAvatar mood={beat.mood ?? "idea"} size={centered ? 156 : 118} />
              <div className="time-badge"><span aria-hidden="true">{badge.slice(0, sp)}</span><b>{badge.slice(sp + 1)}</b></div>
              <button className="tour-close" aria-label="終了" title="ツアーを終了（Esc）" onClick={() => onExit("aborted")}>×</button>
            </div>

            <div className={`tour-body${normal ? " left" : ""}`}>
              {normal && progress}
              {isBreak && <div className="mint-pill">{beat.title}</div>}
              {final && progress}
              {final && <div className="pale-pill">🎉 水曜日ツアー完走 🏆</div>}

              <h3 id="tour-title" className="tour-title">
                {welcome ? "WorkRelay AI へようこそ！" : isBreak ? beat.text : beat.title}
              </h3>
              {welcome && <p className="tour-sub">{beat.title}</p>}
              {welcome && (
                <p className="tour-intro">
                  WorkRelay AIは、メール・Teams チャット・予定表から<br />
                  「今日やること」を見つけ、優先順位をつけ、<br />
                  返信や会議資料の下書きまで用意する、あなたのアシスタントです。
                </p>
              )}
              {(welcome || isBreak) && progress}

              <p id="tour-text" className="tour-text">
                {isBreak ? beat.next : beat.text}
              </p>

              {normal && sceneTotal > 1 && (
                <div className="tour-step" aria-label={`この場面の見どころ ${sceneTotal}か所中 ${sceneNo}か所目`}>
                  この場面の見どころ {sceneNo} / {sceneTotal}
                  <span className="tour-dots" aria-hidden="true">
                    {Array.from({ length: sceneTotal }, (_, i) => <span key={i} className={i < sceneNo ? "on" : ""} />)}
                  </span>
                </div>
              )}

              {welcome && (
                <>
                  <ul className="note-pills" aria-label="このデモについて">
                    <li>架空の業務データ</li>
                    <li>固定ルールで判定（生成AIは未使用）</li>
                    <li>目安5分・自分のペースで</li>
                  </ul>
                </>
              )}

              {isBreak && (
                <div className="break-body">
                  <div>
                    <h4>ここまでで見たこと</h4>
                    <ul>{beat.recap?.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                  <div>
                    <h4>WorkRelay AI のポイント</h4>
                    <ul className="break-points">{beat.points?.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                </div>
              )}

              {final && <p className="faint final-note">Microsoft 365 との実連携は未実装・未検証です（紹介した接続手順は導入時の想定）。</p>}

              {normal && (beat.detail || beat.can) && (
                <div className="tour-links">
                  {beat.detail && (
                    <details className="tour-more" open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
                      <summary>詳しく見る →</summary>
                      <p>{beat.detail}</p>
                    </details>
                  )}
                  {beat.can && (
                    <details className="tour-more" open={canOpen} onToggle={(e) => setCanOpen((e.target as HTMLDetailsElement).open)}>
                      <summary>この画面でできること →</summary>
                      <ul>{beat.can.map((c) => <li key={c}>{c}</li>)}</ul>
                      <button className="btn try-btn" onClick={startTry}>🧪 この画面で試してみる</button>
                    </details>
                  )}
                </div>
              )}

              {/* ボタン：ウェルカムは「スキップ」と「次へ」、通常と小休止は右に「次へ」（左は控えめな「戻る」）、最後は横いっぱいの「ツアーを完了」 */}
              <div className={`tour-buttons${welcome ? " pair" : final ? " full" : " right"}`}>
                {welcome && <button className="btn tbtn ghost-btn" onClick={() => onExit("free")}>スキップ</button>}
                {!welcome && !final && <button className="btn back-link" disabled={idx <= 0} onClick={() => goTo(idx - 1)}>戻る</button>}
                {final ? (
                  <button className="btn tbtn primary cta" data-tour-focus onClick={() => onExit("free")}>🎉 ツアーを完了</button>
                ) : (
                  <button className="btn tbtn primary cta" data-tour-focus data-next onClick={() => goTo(idx + 1)}>{welcome ? "デモツアーを開始" : "次へ →"}</button>
                )}
              </div>
              {actError && <div className="notice warn" role="status" style={{ marginTop: 8 }}>{actError}</div>}
              {!ready && <div className="faint tour-loading" aria-live="polite">準備中…</div>}

              {/* 場面の移動：‹ › で前後の場面へ、場面番号を押すと一覧からどの場面へも移れる（Shift＋← → でも操作できる） */}
              <div className="tour-head tour-jump-row">
                <span id="tour-scene" className="tour-scene">
                  {isBreak ? `小休止 ${breakNo} / ${breakTotal}　${beat.sceneName}` : `${beat.time}　${CIRCLED[beat.scene - 1]} ${beat.sceneName}`}
                </span>
                <span className="tour-count tour-jump">
                  <button className="jump-btn" aria-label="前の場面へ" title="前の場面へ（Shift＋←）" disabled={prevScene < 0} onClick={() => jumpTo(prevScene)}>‹</button>
                  <button className="scene-pick" aria-haspopup="listbox" aria-expanded={pickOpen} aria-label="場面を選んで移動"
                    onClick={() => setPickOpen((v) => !v)}>
                    {isBreak ? `場面 ${beat.scene} / ${SCENE_COUNT} まで` : `場面 ${beat.scene} / ${SCENE_COUNT}`} ▾
                  </button>
                  <button className="jump-btn" aria-label="次の場面へ" title="次の場面へ（Shift＋→）" disabled={nextScene < 0} onClick={() => jumpTo(nextScene)}>›</button>
                </span>
                {pickOpen && (
                  <ul className="scene-menu" role="listbox" aria-label="場面を選んで移動"
                    ref={(el) => el?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()}>
                    {unitStarts.map((st, u) => (
                      <li key={st}>
                        <button role="option" aria-selected={u === curUnit} className={beats[st].kind === "break" ? "is-break" : ""}
                          onClick={() => jumpTo(st)}
                          onKeyDown={(e) => {
                            const items = Array.from(e.currentTarget.closest("ul")?.querySelectorAll<HTMLElement>("button") ?? []);
                            const i = items.indexOf(e.currentTarget);
                            if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
                            if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(i - 1, 0)]?.focus(); }
                          }}>
                          {unitLabel(st)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
          );
        })()}
      </div>
    </div>
  );
}

// 使い方（初回ツアー・画面の説明）の設定と、「？」の説明アイコン
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

const TIP_WIDTH = 280;

// ---- 設定の保存（このブラウザだけ。サーバーには送らないので、デモをやり直しても残る）
const KEY_TOUR_SEEN = "workrelay.tourSeen"; // 初回の概要を閉じた／スキップした
const KEY_HELP_ON = "workrelay.helpOn"; // 画面の説明 ON／OFF

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // プライベートモードなどで使えないときは、毎回初回として扱う
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 保存できなくても画面は動かす */
  }
}
const KEY_THEME = "workrelay.theme"; // 表示テーマ（light / dark）

export type Theme = "light" | "dark";
export const prefs = {
  theme: (): Theme => (read(KEY_THEME) === "dark" ? "dark" : "light"), // 初期値はライト（OSの設定にかかわらず）
  setTheme: (t: Theme) => {
    write(KEY_THEME, t);
    document.documentElement.setAttribute("data-theme", t); // 色だけを切り替えるので、画面の状態はそのまま
  },
  tourSeen: () => read(KEY_TOUR_SEEN) === "1",
  setTourSeen: () => write(KEY_TOUR_SEEN, "1"),
  helpOn: () => read(KEY_HELP_ON) !== "0", // 初期値は ON（一度 OFF にしたら OFF のまま）
  setHelpOn: (on: boolean) => write(KEY_HELP_ON, on ? "1" : "0"),
};

// ---- 画面の説明（「？」）の文言。何の情報か・何のために見るかを1〜2文で
export const HELP_TEXT = {
  now: "今日すぐに動くべき仕事です。期限の変更や、相手が待っている確認を上に並べています。",
  next: "この依頼で次に取る行動と、その理由です。時間は予定表の空きと見積もりから計算しています。",
  candidate: "別のメールやチャットが、同じ仕事の連絡かを確かめる場所です。元の連絡を見て判断できます。",
  slots: "希望期限と引き受け済みの期限を比べ、予定表に作業時間があるかを確認できます。",
  report: "朝の段取り時間や確認の往復回数などを、期間と件数つきで振り返る画面です。",
} as const;
export type HelpId = keyof typeof HELP_TEXT;

// ---- 一度に開く説明は1つだけ。どの画面からでも同じ状態を見られるよう Context で共有する
type HelpState = { on: boolean; openId: HelpId | null; setOpenId: (id: HelpId | null) => void };
export const HelpContext = createContext<HelpState>({ on: false, openId: null, setOpenId: () => {} });

/** 見出しの横に置く「？」。画面の説明が ON のときだけ表示する */
export function HelpTip({ id, label }: { id: HelpId; label: string }) {
  const { on, openId, setOpenId } = useContext(HelpContext);
  const btn = useRef<HTMLButtonElement>(null);
  const open = openId === id;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 吹き出しは画面に固定して表示する（ペインの端で切れないよう、画面内に収まる位置を計算）
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(TIP_WIDTH, window.innerWidth - 24);
      setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left - 8, window.innerWidth - w - 12)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpenId(null);
        btn.current?.focus(); // 閉じたら「？」にフォーカスを戻す
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`[data-help="${id}"]`)) setOpenId(null);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, id, setOpenId]);

  if (!on) return null;
  return (
    <span className="help-wrap" data-help={id}>
      <button ref={btn} type="button" className="help-icon" aria-label={`${label}の説明`} aria-expanded={open}
        aria-controls={`help-${id}`} onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : id); }}>
        ?
      </button>
      {open && (
        <span id={`help-${id}`} role="note" className="help-pop"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}>
          {HELP_TEXT[id]}
        </span>
      )}
    </span>
  );
}

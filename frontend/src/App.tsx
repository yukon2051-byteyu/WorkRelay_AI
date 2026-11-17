import { useCallback, useEffect, useRef, useState } from "react";
import { api, Card, dataSpace, Health, Home, tracking } from "./api";
import RequestDetail from "./components/RequestDetail";
import { ExitDest, IntroDialog, StoryTour } from "./components/Tour";
import { Beat, buildStory, resolveIds } from "./tour/story";
import { HelpContext, HelpId, prefs, Theme } from "./help";
import { IconCalendar, IconChart, IconInbox, IconPlug, IconToday } from "./icons";
import { CalendarPage, RequestsPage, SettingsPage } from "./pages/Others";
import ReportPage from "./pages/Report";
import Today from "./pages/Today";

type Page = "today" | "requests" | "calendar" | "report" | "settings";

export default function App() {
  // URL の ?page=…&open=依頼ID&focus=… で、特定の画面・依頼を直接開ける（根拠リンクや共有用）
  const params = new URLSearchParams(window.location.search);
  const [page, setPage] = useState<Page>((params.get("page") as Page) || "today");
  const [mode, setMode] = useState("demo");
  const [m365, setM365] = useState<Health["m365"]>({ implemented: false, connectable: false });
  const [guideOpen, setGuideOpen] = useState(params.get("guide") === "1");
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: number; focus?: string } | null>(
    params.get("open") ? { id: Number(params.get("open")), focus: params.get("focus") ?? undefined } : null,
  );
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // ---- 使い方：初回の概要・ツアー・画面の説明（設定はこのブラウザに保存。デモをやり直しても残る）
  const [showIntro, setShowIntro] = useState(false);
  const [tourBeats, setTourBeats] = useState<Beat[] | null>(null); // null = ツアー中でない
  const [tourStarting, setTourStarting] = useState(false);
  const tourSpeed = Math.max(1, Number(params.get("tourSpeed")) || 1); // 確認用の早送り（通常は1）
  const [helpOn, setHelpOnState] = useState(prefs.helpOn());
  const [openTip, setOpenTip] = useState<HelpId | null>(null);
  const [howtoOpen, setHowtoOpen] = useState(false);
  const howtoBtn = useRef<HTMLButtonElement>(null);
  const setHelpOn = (on: boolean) => {
    prefs.setHelpOn(on);
    setHelpOnState(on);
    if (!on) setOpenTip(null); // OFF にしたら開いている説明も閉じる
  };

  const load = useCallback(async () => {
    try {
      const h = await api.health();
      setMode(h.mode);
      setM365(h.m365);
      setHome(await api.home());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const topCard: Card | undefined = home?.sections.find((s) => s.key === "now")?.items[0];

  // 初回の表示：概要を出す（閉じる・スキップしたら、このブラウザでは次回から出さない）
  const [firstChecked, setFirstChecked] = useState(false);
  useEffect(() => {
    if (!home || firstChecked) return;
    setFirstChecked(true);
    if (!prefs.tourSeen() && page === "today" && topCard && !params.get("open")) {
      setShowIntro(true);
      return;
    }
    // 横長の画面（1600px以上）では、最初に「まずこれ」の詳細を開いて右側の余白を活用する
    if (!selected && topCard && window.innerWidth >= 1600) setSelected({ id: topCard.request_id });
  }, [home, firstChecked]); // eslint-disable-line react-hooks/exhaustive-deps

  // 何か操作したら：画面全体を読み直し、結果を短く知らせる
  const changed = useCallback(async (message: string) => {
    setToast(message);
    setVersion((v) => v + 1);
    await load();
    window.setTimeout(() => setToast(null), 3500);
  }, [load]);

  const ingest = async () => {
    try {
      const r = await api.ingest();
      changed(`取り込みました（新しい連絡 ${r.new_messages}件）`);
    } catch (e) {
      changed(`取り込みに失敗しました：${(e as Error).message}`);
    }
  };
  // 「今日やること」を表示したら、朝の確認の開始として記録する（段取り時間の計測。ツアー中は記録しない）
  useEffect(() => {
    if (home && page === "today" && !showIntro && !tourBeats) tracking.homeOpened();
  }, [home, page, showIntro, tourBeats]);

  const resetDemo = async () => {
    tracking.restart();
    await api.resetDemo();
    setSelected(null);
    await ingest();
  };

  // ---- 3分デモツアー。ツアー中はツアー専用のデータ領域を使い、利用者のデモのデータを変えない
  const refresh = useCallback(async () => {
    setVersion((v) => v + 1);
    await load();
  }, [load]);
  const resetTourData = useCallback(async () => {
    await api.resetDemo(); // ツアー専用の領域だけを初期状態に戻す（dataSpace が tour のとき）
    await api.ingest();
    await refresh();
  }, [refresh]);

  const startTour = async () => {
    setShowIntro(false);
    setHowtoOpen(false);
    setOpenTip(null);
    setTourStarting(true);
    try {
      dataSpace.set("tour");
      await resetTourData();
      const ids = await resolveIds();
      const ctl = {
        page: (p: Page) => setPage(p),
        select: (id: number | null, focus?: string) => setSelected(id == null ? null : { id, focus }),
        guide: (open: boolean) => setGuideOpen(open),
        refresh,
      };
      setTourBeats(buildStory(ctl, ids));
    } catch (e) {
      dataSpace.set("demo");
      await refresh();
      setToast(`ツアーを開始できませんでした：${(e as Error).message}`);
    } finally {
      setTourStarting(false);
    }
  };

  /** ツアーを終える：利用者のデモの領域に戻り、選んだ画面を開く */
  const exitTour = async (dest: ExitDest) => {
    prefs.setTourSeen();
    setTourBeats(null);
    dataSpace.set("demo");
    setGuideOpen(false);
    setSelected(null);
    setPage("today");
    await refresh();
    const reqs = await api.requests().catch(() => []);
    const sales = reqs.find((r) => r.title.startsWith("売上資料"));
    if (dest === "reply" && sales) setSelected({ id: sales.id, focus: "draft" });
    else if (dest === "document" && sales) setSelected({ id: sales.id, focus: "document" });
    else if (dest === "calendar") setPage("calendar");
    else if (dest === "report") setPage("report");
    if (dest === "aborted") window.setTimeout(() => howtoBtn.current?.focus(), 50); // 開始ボタンにフォーカスを戻す
    else if (dest === "free") window.setTimeout(() => document.querySelector<HTMLElement>(".card-top")?.focus(), 300);
  };
  const skipIntro = () => {
    prefs.setTourSeen();
    setShowIntro(false);
    window.setTimeout(() => howtoBtn.current?.focus(), 0);
  };

  const cards: Card[] = home ? home.sections.flatMap((s) => s.items) : [];
  const selectedCard = cards.find((c) => c.request_id === selected?.id);
  const nowCount = home?.sections.find((s) => s.key === "now")?.items.length ?? 0;

  const navItem = (key: Page, label: string, icon: JSX.Element, count?: number) => (
    <button key={key} className="nav-item" aria-current={page === key ? "page" : undefined} onClick={() => setPage(key)} title={label}>
      {icon}<span className="nav-label">{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </button>
  );

  return (
    <HelpContext.Provider value={{ on: helpOn, openId: openTip, setOpenId: setOpenTip }}>
      <div className="shell">
        <nav className="nav" aria-label="メイン">
          <div className="nav-brand">W<span className="nav-brand-text">orkRelay <span>AI</span></span></div>
          {navItem("today", "今日やること", <IconToday />, nowCount)}
          {navItem("requests", "依頼", <IconInbox />)}
          <div data-tour="nav-more" className="nav-group">
            {navItem("calendar", "予定表", <IconCalendar />)}
            {navItem("report", "改善レポート", <IconChart />)}
          </div>
          <div className="nav-spacer" />
          {navItem("settings", "接続設定", <IconPlug />)}
          <button className="nav-guide-link" aria-label="実際の業務で使うには" title="実際の業務で使うには"
            onClick={() => { setPage("settings"); setGuideOpen(true); }}>
            <span className="nav-label">実際の業務で使うには</span>
            <span className="nav-short" aria-hidden="true">?</span>
          </button>
        </nav>

        <div className="main">
          {/* 共通ヘッダー：デモの案内（控えめ）と「使い方」 */}
          <div className="demo-bar" role="note">
            {mode === "demo" && (
              <>
                <span className="demo-tag">デモ</span>
                <span>架空データ／依頼の抽出・優先順位は固定ルールで判定（生成AIは未使用）／時刻は 11/18（水）9:00 に固定</span>
              </>
            )}
            <span className="spacer" />
            <ThemeSwitch />
            <div className="menu-wrap">
              <button ref={howtoBtn} className="btn ghost" aria-haspopup="menu" aria-expanded={howtoOpen}
                onClick={() => setHowtoOpen((v) => !v)}>使い方 ▾</button>
              {howtoOpen && (
                <HowtoMenu
                  helpOn={helpOn}
                  canTour={!tourStarting && mode === "demo"}
                  onTour={startTour}
                  onToggleHelp={() => setHelpOn(!helpOn)}
                  onClose={() => { setHowtoOpen(false); howtoBtn.current?.focus(); }}
                />
              )}
            </div>
            {mode === "demo" && <button className="btn ghost" onClick={resetDemo} disabled={!!tourBeats}>デモを最初からやり直す</button>}
          </div>

          {error ? (
            <div className="list-pane">
              <div className="error-box">
                <b>サーバーに接続できません</b>（{error}）<br />
                バックエンドが起動しているか確認してください。<br />
                <button className="btn" style={{ marginTop: 10 }} onClick={load}>再接続する</button>
              </div>
            </div>
          ) : !home ? (
            <div className="list-pane muted">読み込み中…</div>
          ) : (
            <div className={`workspace${selected ? " with-detail" : ""}`}>
              {/* 一覧は常に表示したまま（選択位置とスクロール位置を保つ）。他のページは重ねて切り替える */}
              <div className="pane list-pane"><div className="list-inner">
                <div hidden={page !== "today"}>
                  <Today home={home} selectedId={selected?.id ?? null} onSelect={(id, focus) => setSelected(id == null ? null : { id, focus })} onChanged={changed} onIngest={ingest} />
                </div>
                {page === "requests" && <RequestsPage nowIso={home.now} version={version} onOpen={(id) => setSelected({ id })} />}
                {page === "calendar" && <CalendarPage home={home} onOpen={(id) => setSelected({ id, focus: "slots" })} />}
                {page === "report" && <ReportPage version={version} />}
                {page === "settings" && <SettingsPage mode={mode} m365={m365} guideOpen={guideOpen} onToggleGuide={setGuideOpen} />}
              </div></div>
              {selected && (
                <aside className="pane detail-pane" aria-label="依頼の詳細">
                  <RequestDetail
                    key={selected.id}
                    requestId={selected.id}
                    card={selectedCard}
                    nowIso={home.now}
                    events={home.events}
                    freeSlots={home.free_slots}
                    focus={selected.focus}
                    version={version}
                    onChanged={changed}
                    onClose={() => setSelected(null)}
                  />
                </aside>
              )}
            </div>
          )}
        </div>
        {toast && <div className="toast" role="status">{toast}</div>}

        {showIntro && <IntroDialog onStart={startTour} onSkip={skipIntro} />}
        {tourStarting && <div className="toast" role="status">ツアーを準備しています…</div>}
        {tourBeats && <StoryTour beats={tourBeats} speed={tourSpeed} resetData={resetTourData} onExit={exitTour} />}
      </div>
    </HelpContext.Provider>
  );
}

/** 表示テーマの切り替え（ライト／ダーク）。現在の選択を文字・アイコン・押下状態で示す */
function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(prefs.theme());
  const choose = (t: Theme) => { prefs.setTheme(t); setTheme(t); };
  return (
    <div className="theme-switch" role="group" aria-label="表示テーマ">
      <span className="theme-label">表示テーマ</span>
      <button className={theme === "light" ? "on" : ""} aria-pressed={theme === "light"} onClick={() => choose("light")}>
        <span aria-hidden="true">☀</span> ライト
      </button>
      <button className={theme === "dark" ? "on" : ""} aria-pressed={theme === "dark"} onClick={() => choose("dark")}>
        <span aria-hidden="true">☾</span> ダーク
      </button>
    </div>
  );
}

/** 「使い方」メニュー：ツアーの再生と、画面の説明の ON／OFF */
function HowtoMenu({ helpOn, canTour, onTour, onToggleHelp, onClose }: {
  helpOn: boolean; canTour: boolean; onTour: () => void; onToggleHelp: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role^=menuitem]:not(:disabled)")?.focus();
    const onDown = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  return (
    <div className="menu howto-menu" role="menu" ref={ref}
      onKeyDown={(e) => {
        const list = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? []);
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      }}>
      <button role="menuitem" className="menu-item" disabled={!canTour} onClick={onTour}>5分デモツアーを再生</button>
      <button role="menuitemcheckbox" aria-checked={helpOn} className="menu-item menu-check" onClick={onToggleHelp}>
        画面の説明を表示 <span className={`switch${helpOn ? " on" : ""}`} aria-hidden="true">{helpOn ? "ON" : "OFF"}</span>
      </button>
    </div>
  );
}

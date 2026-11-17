import { useCallback, useEffect, useState } from "react";
import { api, Card, Health, Home } from "./api";
import RequestDetail from "./components/RequestDetail";
import { IconCalendar, IconChart, IconInbox, IconPlug, IconToday } from "./icons";
import { CalendarPage, ReportPage, RequestsPage, SettingsPage } from "./pages/Others";
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

  // 横長の画面（1600px以上）では、最初に「まずこれ」の詳細を開いて右側の余白を活用する
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (!home || autoOpened) return;
    setAutoOpened(true);
    const top = home.sections.find((s) => s.key === "now")?.items[0];
    if (!selected && top && window.innerWidth >= 1600) setSelected({ id: top.request_id });
  }, [home, autoOpened, selected]);

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
  const resetDemo = async () => {
    await api.resetDemo();
    setSelected(null);
    await ingest();
  };

  const cards: Card[] = home ? home.sections.flatMap((s) => s.items) : [];
  const selectedCard = cards.find((c) => c.request_id === selected?.id);
  const nowCount = home?.sections.find((s) => s.key === "now")?.items.length ?? 0;

  const nav: { key: Page; label: string; icon: JSX.Element; count?: number }[] = [
    { key: "today", label: "今日やること", icon: <IconToday />, count: nowCount || undefined },
    { key: "requests", label: "依頼", icon: <IconInbox /> },
    { key: "calendar", label: "予定表", icon: <IconCalendar /> },
    { key: "report", label: "改善レポート", icon: <IconChart /> },
  ];

  return (
    <div className="shell">
      <nav className="nav" aria-label="メイン">
        <div className="nav-brand">W<span className="nav-brand-text">orkRelay <span>AI</span></span></div>
        {nav.map((n) => (
          <button key={n.key} className="nav-item" aria-current={page === n.key ? "page" : undefined} onClick={() => setPage(n.key)} title={n.label}>
            {n.icon}<span className="nav-label">{n.label}</span>
            {n.count && <span className="count">{n.count}</span>}
          </button>
        ))}
        <div className="nav-spacer" />
        <button className="nav-item" aria-current={page === "settings" ? "page" : undefined} onClick={() => setPage("settings")} title="接続設定">
          <IconPlug /><span className="nav-label">接続設定</span>
        </button>
        <button className="nav-guide-link" aria-label="実際の業務で使うには" title="実際の業務で使うには"
          onClick={() => { setPage("settings"); setGuideOpen(true); }}>
          <span className="nav-label">実際の業務で使うには</span>
          <span className="nav-short" aria-hidden="true">?</span>
        </button>
      </nav>

      <div className="main">
        {mode === "demo" && (
          <div className="demo-bar" role="note">
            <span className="demo-tag">デモ</span>
            <span>架空データ／依頼の抽出・優先順位は固定ルールで判定（生成AIは未使用）／時刻は 11/18（水）9:00 に固定</span>
            <span className="spacer" />
            <button className="btn ghost" onClick={resetDemo}>デモを最初からやり直す</button>
          </div>
        )}

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
              {page === "calendar" && <CalendarPage home={home} />}
              {page === "report" && <ReportPage />}
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
    </div>
  );
}

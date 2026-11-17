// 「依頼」「予定表」「改善レポート」「接続設定」のページ
import { useEffect, useState } from "react";
import { api, fmtDue, fmtTime, Health, Home, RequestDetail, statusClass } from "../api";

export function RequestsPage({ nowIso, version, onOpen }: { nowIso: string; version: number; onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<RequestDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.requests().then(setRows).catch((e) => setError(e.message));
  }, [version]);
  if (error) return <div className="error-box">依頼一覧を読み込めませんでした：{error}</div>;
  if (!rows) return <p className="muted">読み込み中…</p>;
  return (
    <>
      <div className="page-head"><h1>依頼</h1><span className="sub">受け付けたすべての依頼（{rows.length}件）</span></div>
      {rows.length === 0 ? <div className="empty"><h2>依頼はまだありません</h2></div> : (
        <table className="table">
          <thead><tr><th>依頼</th><th>種別</th><th>依頼者</th><th>状態</th><th>不足</th><th>確定期限</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}>
                <td>{r.title}</td>
                <td>{r.type_name}</td>
                <td>{r.requester_name}</td>
                <td><span className={`badge ${statusClass(r.status)}`}>{r.status_label}</span></td>
                <td>{r.missing_fields.length ? r.missing_fields.join("・") : "—"}</td>
                <td>{fmtDue(r.committed_due, nowIso)}{r.due_change_status && <span className="badge warn" style={{ marginLeft: 6 }}>期限調整</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function CalendarPage({ home }: { home: Home }) {
  const rows = [
    ...home.events.map((e) => ({ start: e.start_at, end: e.end_at, label: e.title, cls: e.kind === "work" ? "work" : "" })),
    ...home.free_slots.map((s) => ({ start: s.start, end: s.end, label: `空き ${s.minutes}分`, cls: "free" })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <>
      <div className="page-head"><h1>予定表</h1><span className="sub">{fmtDue(home.now)} の予定（デモ内の予定表）</span></div>
      <div className="timeline" style={{ maxWidth: 640 }}>
        {rows.map((r, i) => (
          <div key={i} className={`tl-row ${r.cls}`}>
            <span className="tl-time">{fmtTime(r.start)}–{fmtTime(r.end)}</span><span>{r.label}</span>
          </div>
        ))}
      </div>
      <p className="faint">勤務時間 9:00–18:00、昼休み 12:00–13:00 を除いて空き時間を計算しています。</p>
    </>
  );
}

export function ReportPage() {
  return (
    <>
      <div className="page-head"><h1>改善レポート</h1></div>
      <div className="empty">
        <h2>計測データを準備中です</h2>
        <p>朝の段取り時間・確認の往復回数・下書きの利用状況は、操作の記録を集計して表示します（ステップ8で追加）。</p>
      </div>
    </>
  );
}

export function SettingsPage({ mode, m365, guideOpen, onToggleGuide }: {
  mode: string; m365: Health["m365"]; guideOpen: boolean; onToggleGuide: (open: boolean) => void;
}) {
  // リンクから開いたときは、案内の位置までスクロールする
  useEffect(() => {
    if (guideOpen) document.getElementById("real-use-guide")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [guideOpen]);

  return (
    <>
      <div className="page-head"><h1>接続設定</h1></div>
      <table className="table" style={{ maxWidth: 720 }}>
        <thead><tr><th>取り込み元</th><th>状態</th><th>説明</th></tr></thead>
        <tbody>
          <tr>
            <td>デモデータ（架空）</td>
            <td>{mode === "demo" ? <span className="badge ok">使用中</span> : <span className="badge">未使用</span>}</td>
            <td>架空のメール・Teams・予定表。Microsoft アカウントは不要です。</td>
          </tr>
          <tr>
            <td>Microsoft 365（Outlook / Teams / 予定表）</td>
            <td><span className="badge">未接続</span></td>
            <td>
              {m365.implemented ? "この環境では接続を無効にしています。" : "実連携は未実装です。"}
              デモと実環境のデータは別のデータベースに保存し、混在させません。
            </td>
          </tr>
        </tbody>
      </table>

      <section className="guide" id="real-use-guide" aria-labelledby="real-use-title">
        <button className="guide-toggle" aria-expanded={guideOpen} aria-controls="real-use-body" onClick={() => onToggleGuide(!guideOpen)}>
          <h2 id="real-use-title">実際の業務で使うには</h2>
          <span aria-hidden="true">{guideOpen ? "▴" : "▾"}</span>
        </button>
        {guideOpen && (
          <div id="real-use-body" className="guide-body">
            {!m365.connectable && (
              <p className="notice info" style={{ marginTop: 0 }}>
                この公開デモでは、実際のMicrosoft 365アカウントには接続できません。
              </p>
            )}
            <p>
              この公開デモでは、架空のメール・Teamsチャット・予定表を使って、今日の仕事の整理や下書きの作成を体験できます。ログインは不要です。
            </p>
            <h3>{m365.implemented ? "実利用時の接続手順" : "実連携を実装した場合の接続手順"}</h3>
            <ol>
              <li>WorkRelay AIの「接続設定」から「Microsoft 365に接続」を選びます。</li>
              <li>
                Microsoftの画面で職場アカウントにサインインし、Outlookメール・Teamsチャット・予定表の読み取りを許可します。
                会社の設定によっては、Microsoft 365管理者の承認が必要です。
              </li>
              <li>接続できたデータを同期すると、届いた依頼や今日の予定をもとに、優先順位と返信案を確認できます。</li>
            </ol>
            <p className="faint">
              Outlookへの下書き保存や予定表への作業枠の登録を使う場合は、読み取りとは別に書き込みの権限が必要です。
            </p>
            {/* 接続できる環境でだけ、実際に操作できるボタンを出す */}
            {m365.connectable && <button className="btn primary">Microsoft 365に接続</button>}
          </div>
        )}
      </section>
    </>
  );
}

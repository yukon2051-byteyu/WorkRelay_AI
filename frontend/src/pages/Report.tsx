import { useEffect, useState } from "react";
import { api, Report } from "../api";
import { HelpTip } from "../help";

/** 値の出どころのラベル。色だけに頼らず、必ず文字で区別する */
function Src({ kind, text }: { kind: "sample" | "measured" | "real"; text: string }) {
  return <span className={`src src-${kind}`}>{kind === "sample" ? "◇ " : kind === "measured" ? "● " : "○ "}{text}</span>;
}

function fmtSec(s: number) {
  const m = Math.floor(s / 60);
  return m ? `${m}分${s % 60}秒` : `${s}秒`;
}

export default function ReportPage({ version }: { version: number }) {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.report().then(setR).catch((e) => setError(e.message));
  }, [version]);

  if (error) return <div className="error-box">改善レポートを読み込めませんでした：{error}</div>;
  if (!r) return <p className="muted">読み込み中…</p>;
  const L = r.labels;
  const t = r.template_change;
  const d = r.drafts.drafts;
  const usageRows: [string, number][] = [
    ["そのまま使った", d.as_is], ["編集して使った", d.edited], ["使わなかった", d.unused], ["まだ判断していない", d.pending],
  ];

  return (
    <div className="report">
      <div className="page-head">
        <h1>改善レポート<HelpTip id="report" label="改善レポート" /></h1>
        <span className="sub">値の出どころ：<Src kind="sample" text={L.sample} />　<Src kind="measured" text={L.measured} />　<Src kind="real" text={L.real} /></span>
      </div>

      {/* ---- 1. 朝の段取り時間 ---- */}
      <section className="rp" data-tour="rp-morning">
        <h2>朝の段取り時間</h2>
        <p className="faint">{r.morning.sample.condition}</p>
        <div className="tiles">
          <div className="tile">
            <Src kind="sample" text="サンプル値" />
            <div className="tile-label">{r.morning.sample.before.label}</div>
            <div className="tile-value">{r.morning.sample.before.median_minutes}<small>分</small></div>
            <div className="faint">{r.morning.sample.before.period}・{r.morning.sample.before.days}営業日の中央値</div>
          </div>
          <div className="tile">
            <Src kind="sample" text="サンプル値" />
            <div className="tile-label">{r.morning.sample.after.label}</div>
            <div className="tile-value">{r.morning.sample.after.median_minutes}<small>分</small></div>
            <div className="faint">{r.morning.sample.after.period}・{r.morning.sample.after.days}営業日の中央値</div>
          </div>
          <div className="tile">
            <Src kind="measured" text="デモ中の実測値" />
            <div className="tile-label">このデモでの段取り時間</div>
            {r.morning.measured ? (
              <>
                <div className="tile-value">{fmtSec(r.morning.measured.latest_seconds)}</div>
                <div className="faint">直近の1回（計測 {r.morning.measured.count}回・中央値 {fmtSec(r.morning.measured.median_seconds)}）</div>
              </>
            ) : (
              <p className="muted" style={{ margin: "6px 0 0" }}>まだ計測していません。「今日やること」を開いて最初の操作をすると計測されます。</p>
            )}
          </div>
          <div className="tile">
            <Src kind="real" text="実利用の計測値" />
            <div className="tile-label">実際の業務での段取り時間</div>
            <p className="muted" style={{ margin: "6px 0 0" }}>未計測（Microsoft 365 との実連携後に計測します）</p>
          </div>
        </div>
      </section>

      {/* ---- 2. 確認の往復と、着手可能までの時間 ---- */}
      <section className="rp" data-tour="rp-flow">
        <h2>確認の往復回数と、着手可能までの時間 <Src kind="measured" text="デモ中の実測値" /></h2>
        <p className="faint">集計条件：{r.flow.condition}／期間：{r.flow.period ?? "—"}（デモの架空データと、デモ中の操作の記録）</p>
        <table className="table">
          <thead><tr><th>依頼種別</th><th>対象件数</th><th>初回で情報がそろった割合</th><th>確認の往復（平均）</th><th>着手可能までの時間（平均）</th></tr></thead>
          <tbody>
            {r.flow.by_type.map((x) => (
              <tr key={x.type}>
                <td>{x.type}</td><td className="num">{x.count}件</td><td className="num">{x.complete_first_rate}%</td>
                <td className="num">{x.avg_round_trips}回</td>
                <td className="num">{x.avg_hours_to_ready == null ? "—（まだ着手可能な依頼なし）" : `${x.avg_hours_to_ready}時間（着手可能 ${x.ready_count}件）`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <details className="rp-details">
          <summary>依頼ごとの内訳（{r.flow.rows.length}件）</summary>
          <table className="table">
            <thead><tr><th>依頼</th><th>種別</th><th>往復</th><th>着手可能まで</th><th>初回でそろったか</th></tr></thead>
            <tbody>
              {r.flow.rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.title}</td><td>{x.type}</td><td className="num">{x.round_trips}回</td>
                  <td className="num">{x.hours_to_ready == null ? "まだ" : `${x.hours_to_ready}時間`}</td>
                  <td>{x.complete_first ? "そろった" : "不足あり"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {/* ---- 3. 受付テンプレートの改善（サンプル） ---- */}
      <section className="rp">
        <h2>受付テンプレートを変えた前後の比較 <Src kind="sample" text="サンプル値" /></h2>
        <p className="faint">{t.type}依頼：{t.change}／集計条件：{t.condition}</p>
        <table className="table">
          <thead><tr><th></th><th>期間</th><th>対象件数</th><th>初回で情報がそろう割合</th><th>確認の往復（平均）</th><th>着手可能まで（平均）</th></tr></thead>
          <tbody>
            {[["変更前", t.before], ["変更後", t.after]].map(([label, x]) => {
              const v = x as typeof t.before;
              return (
                <tr key={label as string}>
                  <td>{label as string}</td><td>{v.period}</td><td className="num">{v.count}件</td>
                  <td className="num">{v.complete_first_rate}%</td><td className="num">{v.avg_round_trips}回</td><td className="num">{v.avg_hours_to_ready}時間</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ---- 4. 下書きの利用状況 ---- */}
      <section className="rp">
        <h2>下書きの利用状況 <Src kind="measured" text="デモ中の実測値" /></h2>
        <p className="faint">集計条件：{r.drafts.condition}（返信・確認文の下書き {r.drafts.total}件）</p>
        <table className="table usage">
          <tbody>
            {usageRows.map(([label, n]) => (
              <tr key={label}>
                <td style={{ width: 160 }}>{label}</td>
                <td className="num" style={{ width: 60 }}>{n}件</td>
                <td>
                  <span className="bar" aria-hidden="true"><span style={{ width: `${r.drafts.total ? (n / r.drafts.total) * 100 : 0}%` }} /></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint">会議資料（PowerPoint）のダウンロード：{r.drafts.document_downloads}回</p>
      </section>

      {/* ---- 5. よく抜ける項目 ---- */}
      <section className="rp" data-tour="rp-missing">
        <h2>よく抜ける項目（初回の依頼で不足していた項目） <Src kind="measured" text="デモ中の実測値" /></h2>
        <div className="missing-grid">
          {r.missing.map((m) => (
            <div className="tile" key={m.type}>
              <div className="tile-label">{m.type}（対象 {m.count}件）</div>
              {m.fields.length === 0 ? <p className="muted" style={{ margin: 0 }}>抜けていた項目はありません</p> : (
                <table className="mini">
                  <tbody>{m.fields.map((f) => <tr key={f.field}><td>{f.field}</td><td className="num">{f.count}/{m.count}件</td></tr>)}</tbody>
                </table>
              )}
              {m.hint && <p className="hint">{m.hint}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

import { api, RequestDetail, Slide } from "../api";
import { IconCheck, IconWarn } from "../icons";

type Props = { detail: RequestDetail; onChanged: (message: string) => void };

/** 会議資料のたたき台：参照の許可、スライドのプレビュー、数値の根拠、ダウンロード */
export default function DocumentPanel({ detail, onChanged }: Props) {
  const doc = detail.document;
  const c = doc?.content;

  const toggle = async (name: string, allowed: boolean) => {
    try {
      await api.setFilePermission(detail.id, name, allowed);
      onChanged(allowed ? `『${name}』の参照を許可しました` : `『${name}』の参照の許可を取り消しました`);
    } catch (e) {
      onChanged(`操作に失敗しました：${(e as Error).message}`);
    }
  };
  const generate = async () => {
    try {
      await api.createDocument(detail.id);
      onChanged(doc ? "新しい条件で資料を作り直しました" : "資料のたたき台を作りました");
    } catch (e) {
      onChanged(`資料を作れませんでした：${(e as Error).message}`);
    }
  };

  return (
    <>
      {/* 参照の許可：許可したファイルだけを読む */}
      <div className="files">
        <div className="faint">参照するファイル（許可したものだけを読みます）</div>
        {detail.files.map((f) => (
          <div className="file-row" key={f.name}>
            <span>{f.name}</span>
            {f.allowed ? <span className="badge ok"><IconCheck size={12} />参照を許可済み</span> : <span className="badge">未許可</span>}
            <button className="btn ghost" onClick={() => toggle(f.name, !f.allowed)}>{f.allowed ? "許可を取り消す" : "参照を許可する"}</button>
          </div>
        ))}
      </div>

      {!doc || !c ? (
        <div style={{ marginTop: 10 }}>
          <p className="muted" style={{ margin: "0 0 8px" }}>まだ資料のたたき台はありません。</p>
          <button className="btn primary" onClick={generate}>資料のたたき台を作る</button>
        </div>
      ) : (
        <div className="doc">
          <div className="draft-head">
            <span className="draft-kind">{c.title}</span>
            <span className={`badge ${c.complete ? "ok" : "warn"}`}>
              {c.complete ? <IconCheck size={12} /> : <IconWarn size={12} />}{c.complete ? "数値は元データから集計" : "要確認あり"}
            </span>
            <span className="faint">第{doc.version}版</span>
          </div>
          <div className="faint">{doc.generator}</div>

          {doc.needs_review && (
            <div className="notice warn" role="status">
              <span className="ico"><IconWarn /></span>
              <div>
                <b>更新内容の確認が必要</b>：資料を作った後に、次の条件が変わりました。
                <ul className="changes">{doc.changes.map((x) => <li key={x.label}>{x.label}：{x.old} → <b>{x.new}</b></li>)}</ul>
                <button className="btn" onClick={generate}>新しい条件で作り直す</button>
              </div>
            </div>
          )}
          {c.unconfirmed.length > 0 && (
            <div className="notice warn">
              <span className="ico"><IconWarn /></span>
              <div><b>未確認の項目</b><ul className="changes">{c.unconfirmed.map((u) => <li key={u}>{u}</li>)}</ul></div>
            </div>
          )}

          <div className="slides" aria-label="スライドのプレビュー">
            {c.slides.map((s, i) => <SlidePreview key={s.title} slide={s} no={i + 1} footer={c.footer} />)}
          </div>

          {/* 数値の根拠：どのファイルのどのシート・期間を、何行集計したか */}
          <dl className="draft-meta evidence-grid">
            <dt>参照したファイル</dt><dd>{c.source ? c.source.file : <span className="warn-text">要確認</span>}</dd>
            <dt>シート</dt><dd>{c.source?.sheet ?? "—"}</dd>
            <dt>対象期間</dt><dd>{c.source?.period ?? "要確認"}{c.source?.period_evidence && <span className="faint">　根拠：{c.source.period_evidence}</span>}</dd>
            <dt>集計した行</dt><dd>{c.source ? `${c.source.row_count}行` : "—"}</dd>
            <dt>集計日時</dt><dd>{c.source?.aggregated_at ?? "—"}</dd>
          </dl>

          <div className="btn-row">
            <a className="btn primary" href={api.documentUrl(doc.id)} download
              onClick={() => window.setTimeout(() => onChanged("PowerPointをダウンロードしました"), 300)}>
              PowerPointをダウンロード（編集できる形式）
            </a>
            {!doc.needs_review && <button className="btn ghost" onClick={generate}>作り直す</button>}
          </div>
        </div>
      )}
    </>
  );
}

function SlidePreview({ slide, no, footer }: { slide: Slide; no: number; footer: string }) {
  return (
    <figure className="slide">
      <figcaption>{no}. {slide.title}</figcaption>
      <div className="slide-body">
        {slide.bullets && (
          <ul>{slide.bullets.map((b) => <li key={b} className={b.includes("要確認") ? "warn-text" : ""}>{b}</li>)}</ul>
        )}
        {slide.table && (
          <table className="slide-table">
            <thead><tr>{slide.table.header.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {slide.table.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j} className={v === "要確認" ? "warn-text" : ""}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
        {slide.chart && <div className="faint">＋ 棒グラフ（{slide.chart.series.map((s) => s.name).join("・")}、PowerPointで編集可）</div>}
      </div>
      <div className="slide-foot">{footer}</div>
    </figure>
  );
}

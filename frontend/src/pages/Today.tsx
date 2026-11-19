import { useEffect, useMemo, useState } from "react";
import { api, Card, CHANNEL, fmtDue, Home, tracking } from "../api";
import CardItem from "../components/CardItem";
import { HelpTip } from "../help";
import { ChannelIcon, IconWarn } from "../icons";

type Props = {
  home: Home;
  selectedId: number | null;
  onSelect: (id: number | null, focus?: string) => void;
  onChanged: (message: string) => void;
  onIngest: () => void;
};

/** 240 → 「4時間」、250 → 「4時間10分」、45 → 「45分」 */
function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

export default function Today({ home, selectedId, onSelect, onChanged, onIngest }: Props) {
  const flat: Card[] = useMemo(() => home.sections.flatMap((s) => s.items), [home]);
  // 取り込みの表示：null＝閉じる、"suspicious"＝確認が必要な連絡だけ、"all"＝取り込みの内訳（届いた連絡の分類）
  const [intake, setIntake] = useState<null | "suspicious" | "all">(null);
  const [susOpen, setSusOpen] = useState(false); // 確認が必要な連絡の本文を開いているか
  const s = home.summary;
  const nowItems = home.sections.find((x) => x.key === "now")?.items ?? [];
  // 「まずこれ」は『今すぐ対応』の先頭（優先順位と利用者の並べ替え・後回しを反映済み）。0件なら出さない
  const firstId = nowItems[0]?.request_id ?? null;
  const freeMinutes = home.free_slots.reduce((a, x) => a + x.minutes, 0);

  // キーボード操作（Linear の Triage を参考）：J/K または ↑↓ で移動、Enter で開く、Esc で閉じる、H で後で確認
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=menu]")) return;
      if (document.querySelector(".tour, .overlay")) return; // ツアーや確認ダイアログの表示中は、裏の一覧を動かさない
      const idx = flat.findIndex((c) => c.request_id === selectedId);
      const pick = (i: number) => {
        const c = flat[Math.max(0, Math.min(flat.length - 1, i))];
        if (!c) return;
        onSelect(c.request_id);
        document.querySelector<HTMLElement>(`[data-request-id="${c.request_id}"]`)?.focus();
      };
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); pick(idx + 1); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); pick(idx < 0 ? 0 : idx - 1); }
      else if (e.key === "Escape") onSelect(null);
      else if (e.key === "h" && selectedId != null) handleAction(selectedId, "snooze");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleAction = async (id: number, target: string) => {
    tracking.firstAction(id); // 最初の行動を決めた時刻（朝の段取り時間の計測）
    if (target === "snooze" || target === "unsnooze") {
      try {
        await api.snooze(id, target === "snooze");
        onChanged(target === "snooze" ? "『後で確認』に移しました" : "今日の一覧に戻しました");
      } catch (e) {
        onChanged(`操作に失敗しました：${(e as Error).message}`);
      }
      return;
    }
    onSelect(id, target);
  };

  // 同じ区分の中で、1つ上（下）と入れ替えて保存する
  const move = async (sectionKey: string, id: number, dir: -1 | 1) => {
    const order = home.sections.map((sec) => sec.items.map((c) => c.request_id));
    const sec = order[home.sections.findIndex((x) => x.key === sectionKey)];
    const i = sec.indexOf(id);
    if (i + dir < 0 || i + dir >= sec.length) return;
    [sec[i], sec[i + dir]] = [sec[i + dir], sec[i]];
    try {
      await api.setOrder(order.flat());
      onChanged("並び順を変更しました");
    } catch (e) {
      onChanged(`並び順を保存できませんでした：${(e as Error).message}`);
    }
  };

  // 上の「要確認」は、取り込み全体ではなく、確認が必要な連絡そのものを開く
  const openSuspicious = () => {
    setIntake((v) => (v === null ? "suspicious" : v));
    setSusOpen(true);
    window.setTimeout(() => {
      const el = document.getElementById("suspicious");
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el?.querySelector<HTMLElement>("h3")?.focus();
    }, 0);
  };
  const suspicious = home.fyi.filter((m) => m.category === "suspicious");
  const noAction = home.fyi.filter((m) => m.category === "no_action");

  if (flat.length === 0 && s.new_messages === 0) {
    return (
      <div className="empty">
        <h2>新しい連絡はありません</h2>
        <p>まだ取り込んでいないか、前回の確認以降に届いた連絡がありません。</p>
        <button className="btn primary" onClick={onIngest}>デモの連絡を取り込む</button>
      </div>
    );
  }

  return (
    <>
      <header className="today-head">
        <div className="today-title">
          <h1>今日やること</h1>
          <span className="asof">{fmtDue(home.now)} 時点</span>
        </div>
        <div className="scope">前回の確認（{fmtDue(home.last_checked)}）以降の連絡と、持ち越しの依頼が対象</div>
        <div className="stats">
          <div className="stat now-stat" title="持ち越しの依頼も含めた、今すぐ対応する仕事の数">
            <span className="stat-label">今すぐ対応の仕事</span>
            <span className="stat-value">{nowItems.length}件</span>
          </div>
          <button className={`stat stat-btn${s.suspicious ? " warn" : ""}`} onClick={openSuspicious} disabled={!s.suspicious}
            aria-label={`要確認 ${s.suspicious}件。確認が必要な連絡を開く`} aria-controls="suspicious">
            <span className="stat-label">{s.suspicious > 0 && <IconWarn size={12} />} 要確認</span>
            <span className="stat-value">{s.suspicious}件</span>
          </button>
          <div className="stat free">
            <span className="stat-label">今日の空き</span>
            <span className="stat-value">{fmtMinutes(freeMinutes)}</span>
          </div>
          <button className="btn ghost breakdown-toggle" data-tour="breakdown-toggle" aria-expanded={intake === "all"} aria-controls="breakdown"
            onClick={() => { setIntake((v) => (v === "all" ? null : "all")); setSusOpen(false); }}>
            取り込みの内訳 {intake === "all" ? "▴" : "▾"}
          </button>
        </div>

        {intake && (
          <div className="breakdown" id="breakdown">
            {/* 取り込みの内訳：前回の確認以降に届いた連絡が、どう分類されたか（「今すぐ対応の仕事」は持ち越しも含むので別の数） */}
            {intake === "all" && (
              <>
                <div className="breakdown-title">前回の確認以降に届いた連絡　<b>{s.new_messages}件</b></div>
                <dl className="breakdown-counts">
                  <div><dt>新規依頼</dt><dd>{s.new_requests}件</dd></div>
                  <div><dt>回答</dt><dd>{s.answers}件</dd></div>
                  <div><dt>条件変更・関連候補</dt><dd>{s.changes}件</dd></div>
                  <div><dt>対応不要</dt><dd>{s.no_action}件</dd></div>
                  <div><dt>要確認</dt><dd>{s.suspicious}件</dd></div>
                </dl>
              </>
            )}

            {/* 人の判断が残っている連絡。対応不要とは分けて、先に見せる */}
            {suspicious.length > 0 && (
              <section className="sus-block" id="suspicious" aria-labelledby="sus-title">
                <h3 id="sus-title" tabIndex={-1}><IconWarn size={14} /> 確認が必要な連絡　{suspicious.length}件</h3>
                {suspicious.map((m) => (
                  <div className="sus-item" key={m.id}>
                    <div className="fyi-subject">{m.subject ?? m.snippet}</div>
                    <div className="fyi-meta"><ChannelIcon channel={m.channel} />{CHANNEL[m.channel]} · {m.sender_name}</div>
                    <p className="fyi-reason">{m.reason}</p>
                    <button className="btn" aria-expanded={susOpen} aria-controls={`sus-body-${m.id}`} onClick={() => setSusOpen((v) => !v)}>
                      {susOpen ? "元の連絡を閉じる" : "元の連絡を確認"}
                    </button>
                    {susOpen && (
                      <div className="sus-body" id={`sus-body-${m.id}`}>
                        <div className="faint">元の連絡（表示しているだけで、本文の指示は実行しません）</div>
                        <pre>{m.body ?? m.snippet}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* 今は手を付けなくてよい連絡。折りたたんでおき、必要なときだけ開く */}
            {intake === "all" && noAction.length > 0 && (
              <details className="noaction">
                <summary>対応不要の連絡　{noAction.length}件</summary>
                {noAction.map((m) => (
                  <div className="fyi-row" key={m.id}>
                    <div className="fyi-subject">{m.subject ?? m.snippet}</div>
                    <div className="fyi-meta"><ChannelIcon channel={m.channel} />{CHANNEL[m.channel]} · {m.sender_name}<span className="fyi-reason-inline">　{m.reason}</span></div>
                  </div>
                ))}
              </details>
            )}
            {intake === "suspicious" && (
              <button className="link-btn" onClick={() => setIntake("all")}>取り込みの内訳（{s.new_messages}件の分類）を見る</button>
            )}
          </div>
        )}
      </header>

      {home.sections.filter((sec) => sec.items.length > 0).map((sec) => (
        <section className="section" key={sec.key} aria-label={sec.label}>
          <h2 className={`section-head sec-${sec.key}`}>
            {sec.label}<span className="n">{sec.items.length}件</span>
            {sec.key === "now" && <HelpTip id="now" label="今すぐ対応" />}
          </h2>
          <div className="cards">
            {sec.items.map((c, i) => (
              <CardItem
                key={c.request_id}
                card={c}
                isTop={c.request_id === firstId}
                selected={c.request_id === selectedId}
                nowIso={home.now}
                canUp={i > 0}
                canDown={i < sec.items.length - 1}
                onSelect={() => onSelect(c.request_id)}
                onAction={(target) => handleAction(c.request_id, target)}
                onMove={(dir) => move(sec.key, c.request_id, dir)}
              />
            ))}
          </div>
        </section>
      ))}

      <p className="faint">
        操作：<span className="kbd">J</span>/<span className="kbd">K</span> 移動　<span className="kbd">Enter</span> 開く
        <span className="kbd">Esc</span> 閉じる　<span className="kbd">H</span> 後で確認　「⋯」から作業枠・後で確認・元の連絡・並べ替え
      </p>
    </>
  );
}

// デモツアーの台本（全11場面＋小休止2回）。案内役の青木さんが、見出し＋2行以内の短文でテンポよく紹介する。
// 各「拍（ビート）」は、照らす場所・見出し・短文（細かい説明は「詳しく見る」）と、
//   act    … ツアー専用データへの操作（関連付け・下書きの編集など）。利用者のデモのデータには触れない
//   screen … 背景の画面（ページ・開いている詳細・内訳の開閉など）。指定しない項目は直前の拍から引き継ぐ
// を持つ。画面やタブを移る前には、押す場所を照らす拍を置き、ツアー後に同じ経路をたどれるようにする。
// 戻るとき・場面を飛ばすときは、ツアー専用データを初期状態に戻して act をやり直し、背景の画面も拍の状態にそろえる。
// 文言は誇張しない：サンプル値は「サンプル値」、未実装の連携は「未実装・想定」と書く。
import { api } from "../api";
import type { Mood } from "../components/AokiAvatar";

export type Page = "today" | "requests" | "calendar" | "report" | "settings";

export type TourCtl = {
  page: (p: Page) => void;
  select: (id: number | null, focus?: string) => void;
  guide: (open: boolean) => void;
  refresh: () => Promise<void>;
};

export type Beat = {
  scene: number; // 1〜11
  time: string; // 物語の中の時刻（導入・最後は見出し）
  sceneName: string;
  seconds: number; // 読む時間の目安（自動では進まない。全体の所要時間を見積もるためだけに使う）
  target: string | null; // 照らす場所（null は画面中央に表示。注目枠は出さない）
  kind?: "intro" | "ending" | "break"; // break = 小休止（場面には数えない）
  title: string; // キャッチーな見出し
  text: string; // 2行以内の短文
  mood?: Mood; // 青木さんの表情（省略時は場面の既定）
  detail?: string; // 「詳しく見る」
  can?: string[]; // この画面でできること（ツアー後に試せる）
  recap?: string[]; // 小休止：ここまでで見たこと
  points?: string[]; // 小休止：WorkRelay AI のポイント（見どころ）
  next?: string; // 小休止：このあと見ること
  act?: () => Promise<void>;
  view?: () => Promise<void> | void; // 背景の画面をそろえる（buildStory が screen から作る）
};

/** 4つのチャプター（進捗バー） */
export const CHAPTERS = ["導入", "朝の整理", "段取り", "振り返り"] as const;
/** 場面ごとの時刻バッジ・チャプター・青木さんの既定の画像（判断を問いかける場面は「考える」、結果を確かめて納得する場面は「うんうん納得」、機能を紹介する場面は「ひらめき」） */
export const SCENE_META: Record<number, { badge: string; chapter: number; mood: Mood }> = {
  1: { badge: "🚀 導入", chapter: 0, mood: "morning" },
  2: { badge: "☀️ 09:00", chapter: 1, mood: "morning" },
  3: { badge: "⚡ 09:02", chapter: 1, mood: "think" },
  4: { badge: "✉️ 09:05", chapter: 1, mood: "idea" },
  5: { badge: "📄 09:20", chapter: 2, mood: "idea" },
  6: { badge: "🔓 10:00", chapter: 2, mood: "nod" },
  7: { badge: "🗓️ 10:05", chapter: 2, mood: "idea" },
  8: { badge: "👀 15:00", chapter: 3, mood: "idea" },
  9: { badge: "📊 17:30", chapter: 3, mood: "nod" },
  10: { badge: "🔌 本番イメージ", chapter: 3, mood: "idea" },
  11: { badge: "🎉 完了", chapter: 3, mood: "break1" },
};

export type Ids = { sales: number; expense: number; budget: number };

/** ツアー専用データの依頼IDを、題名から探す（IDの決め打ちをしない） */
export async function resolveIds(): Promise<Ids> {
  const reqs = await api.requests();
  const find = (prefix: string) => reqs.find((r) => r.title.startsWith(prefix))?.id ?? -1;
  return { sales: find("売上資料"), expense: find("経費一覧"), budget: find("来週の予算会議") };
}

const click = (sel: string, expanded: boolean) => {
  const el = document.querySelector<HTMLButtonElement>(sel);
  if (el && (el.getAttribute("aria-expanded") === "true") !== expanded) el.click();
};

/** 拍ごとの「背景の画面」。指定しない項目は、直前の拍から引き継ぐ */
export type Screen = {
  page: Page;
  sel: { id: number; focus?: string } | null; // 右に開いている依頼の詳細（と、その中で開く箇所）
  guide: boolean; // 接続設定の「実際の業務で使うには」を開いているか
  breakdown: boolean; // 「取り込みの内訳」を開いているか
};
type Draft = Omit<Beat, "view"> & { screen?: Partial<Screen> };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** 背景の画面を、拍の状態どおりにそろえる（「戻る」や場面の移動でも、説明と画面が食い違わないように） */
async function applyScreen(ctl: TourCtl, sc: Screen) {
  ctl.guide(sc.guide);
  ctl.page(sc.page);
  ctl.select(sc.sel ? sc.sel.id : null, sc.sel?.focus);
  if (sc.page !== "today") return;
  // 「取り込みの内訳」は「今日やること」が描かれてから開閉する
  for (let i = 0; i < 20 && !document.querySelector("[data-tour=breakdown-toggle]"); i++) await sleep(50);
  click("[data-tour=breakdown-toggle]", sc.breakdown);
}

export function buildStory(ctl: TourCtl, ids: Ids): Beat[] {
  const S = (scene: number, time: string, sceneName: string) => ({ scene, time, sceneName });
  const s1 = S(1, "はじめに", "画面の見方");
  const s2 = S(2, "09:00", "会社に着く");
  const s3 = S(3, "09:02", "昨夜のTeamsを確認する");
  const s4 = S(4, "09:05", "営業への返信を用意する");
  const s5 = S(5, "09:20", "会議資料を準備する");
  const s6 = S(6, "10:00", "別の依頼が着手可能になる");
  const s7 = S(7, "10:05", "予定表で作業枠を確保する");
  const s8 = S(8, "15:00", "対応状況を確認する");
  const s9 = S(9, "17:30", "今日の仕事を振り返る");
  const s10 = S(10, "最後に", "実際の業務で使うには");
  const s11 = S(11, "おわり", "エンディング");

  const can2 = ["並び順を変える（各行の「⋯」→ 上へ／下へ）", "後で確認に回す（「⋯」→ 後で確認、または H キー）", "キーボードで移動（J/K で移動、Enter で開く、Esc で閉じる）"];
  const can3 = ["別の案件として扱う（同じ依頼でなければ、つながない）", "確定期限を変える／そのままにする（つなぐ判断とは別に「期限」タブで決める）"];
  const can4 = ["Teamsで送信したことを記録（記録だけ。実際の送信は Teams で行う）", "使わない", "新しい条件で作り直す（編集した本文は残る）"];
  const can5 = ["参照の許可を取り消す／許可する", "作り直す（条件が変わったときは更新確認が出る）", "PowerPoint をダウンロードして編集"];
  const can6 = ["依頼の一覧から、どの依頼でも詳細を開く", "不足項目を手で入力する", "確認文を作る・後で確認"];
  const can7 = ["作業枠の登録を取り消す", "作業時間を入力する（未見積もりのとき）", "時間が足りないときは「速報版を先に出す」「期限を相談する」"];
  const can8 = ["作業を始める／完了を取り消す", "左の「依頼」で、全件の状態を一覧する"];
  const can9 = ["依頼ごとの内訳を開く", "受付テンプレートを変えた前後の比較（サンプル値）を見る"];
  const navTo = (label: string) => `.nav-item[title="${label}"]`; // 画面を移る前に、押す場所として照らすサイドバーの項目

  const drafts: Draft[] = [
    // ① はじめに（ウェルカム）：画面の見方を1ステップに集約
    { ...s1, kind: "intro", seconds: 10, target: null,
      screen: { page: "today", sel: null, guide: false, breakdown: false },
      title: "5分でわかる！青木さんの水曜日",
      text: "左でメニューを選び、中央で今日やることを見て、右で詳細と根拠を確かめます。" },

    // ② 09:00 会社に着く
    { ...s2, seconds: 7, target: '.section[aria-label="今すぐ対応"] .card-top', can: can2,
      title: "出社！まずは「まずこれ」だけ見ればOK",
      text: "メールもTeamsも、すでに優先度順に並んでいます。",
      detail: "並び順はデモの固定ルールで決めています（条件の変更・相手が待っている確認・期限の近さ・空き時間）。生成AIは使っていません。" },
    { ...s2, seconds: 7, target: "#breakdown", can: can2, screen: { breakdown: true }, mood: "nod",
      title: "届いた16件の仕分けもひと目で",
      text: "確認が必要な1件だけを分けて表示。対応不要の7件は折りたたんであります。",
      detail: "要確認の1件は、AIへの操作を指示する不審なメールです。本文の指示は実行せず、依頼への登録も保留しています。「元の連絡を確認」で本文を見て判断できます。" },

    // ③ 09:02 昨夜のTeamsを確認する
    // まず右ペイン（依頼の詳細）の見方を紹介してから、判断の場面へ
    { ...s3, seconds: 6, target: ".detail-pane", screen: { breakdown: false, sel: { id: ids.sales, focus: "detail" } }, mood: "nod",
      title: "右側に、依頼の詳細が開きます",
      text: "「概要」に次にやること・期限・判断に必要な根拠がまとまり、タブで連絡・期限・下書き・資料を確かめられます。" },
    { ...s3, seconds: 8, target: "[data-sec=candidate]", can: can3, screen: { breakdown: false, sel: { id: ids.sales, focus: "candidate" } },
      title: "「同じ依頼？」は1クリックでサクッと判定",
      text: "AI任せにせず、最後の判断だけ人が選ぶから安心です。",
      detail: "「⚠ 判断待ち」の欄に、Teamsの抜粋と、つないだときの影響（確定期限は今日15:00のまま）をまとめています。全文と理由は「原文と判定理由を見る」から確かめられます。" },
    { ...s3, seconds: 7, target: "[data-sec=summary] .due-line, [data-sec=decided]", can: can3, screen: { sel: { id: ids.sales, focus: "summary" } }, mood: "nod",
      title: "つないでも、確定期限はそのまま",
      text: "今日11:00は「前倒しの相談中」として記録。引き受けた15:00は変わりません。",
      detail: "つなぐ判断と、期限を変える判断は別です。期限を変えるときは「期限」タブの「確定期限を変更」を青木さんが選びます。",
      act: async () => {
        const d = await api.request(ids.sales);
        const c = d.candidates.find((x) => x.status === "pending");
        if (c) await api.acceptCandidate(c.id);
        await ctl.refresh();
      } },

    // ④ 09:05 営業への返信を用意する
    { ...s4, seconds: 5, target: "#tab-draft", can: can4,
      title: "返信案は「下書き」タブに",
      text: "空きは30分、確定版には60分。だから「速報版を先に出す」返信案です。" },
    { ...s4, seconds: 7, target: "[data-sec=draft] .draft textarea", can: can4, screen: { sel: { id: ids.sales, focus: "draft" } },
      title: "返信案は用意済み！中身を見て送るだけ",
      text: "ゼロから文章を書かない朝を体験してみましょう。",
      detail: "青木さんは「会議で特に見たい数字があれば教えてください」と一文を書き足しました。編集した本文は、作り直しても上書きされません。",
      act: async () => {
        const d = (await api.request(ids.sales)).drafts.find((x) => x.kind === "due_adjust");
        if (d && !d.body.includes("見たい数字")) {
          await api.editDraft(d.id, d.body.replace("ご確認いただけますか。", "ご確認いただけますか。会議で特に見たい数字があれば教えてください。"));
        }
        await ctl.refresh();
      } },
    { ...s4, seconds: 6, target: "[data-sec=draft] .draft .btn-row", can: can4,
      title: "送るのは、あなたの操作で",
      text: "コピーしてTeamsで送ります。Outlookへの保存は、デモではアプリ内の記録だけです。",
      act: async () => {
        const d = (await api.request(ids.sales)).drafts.find((x) => x.kind === "due_adjust");
        if (d) await api.draftAction(d.id, "copy");
      } },

    // ☕ 小休止1：朝の整理（取り込み → 関連付け → 返信）が終わったところ
    { ...s4, kind: "break", time: "小休止", sceneName: "朝の整理完了", seconds: 12, target: null, mood: "break1",
      title: "朝の整理完了🎉",
      text: "出社して5分で、朝の整理が終わりました。",
      recap: [
        "届いた16件を分類し、確認が必要な1件を分けた",
        "Teamsの相談を、昨日のOutlookの依頼とつないだ",
        "「速報版を先に出す」返信案を用意した",
      ],
      points: [
        "確定期限と希望期限を分けて表示。勝手に変えない",
        "つなぐかどうかは、抜粋と理由を見て人が決める",
        "送信は人の操作から。編集した本文は上書きしない",
      ],
      next: "次は、会議資料と次の仕事の段取りです。" },

    // ⑤ 09:20 会議資料を準備する
    { ...s5, seconds: 5, target: "#tab-document", can: can5,
      title: "資料の下書きもスタンバイ完了",
      text: "たたき台があるから、すぐブラッシュアップに入れます。" },
    { ...s5, seconds: 6, target: "[data-sec=document] .slides", can: can5, screen: { sel: { id: ids.sales, focus: "document" } },
      title: "3枚のたたき台を用意済み",
      text: "概要・数字と変化・会議で確認したいこと。編集できるPowerPointで受け取れます。" },
    { ...s5, seconds: 6, target: "[data-sec=document] .evidence-grid", can: can5,
      title: "数字には出典つき",
      text: "参照を許可した売上Excelの、どのシート・どの行から集計したかを表示します。",
      detail: "例：法人営業部の10月は4,659万円（前月比+16.9%）。出典は架空の「2026年度_売上実績.xlsx」のシート「売上実績」。元データが足りないときは数値を「要確認」にします。" },
    { ...s5, seconds: 4, target: navTo("依頼"),
      title: "次は、左の「依頼」へ",
      text: "ほかの依頼の状況を見に行きます。" },

    // ⑥ 10:00 別の依頼が着手可能になる
    { ...s6, seconds: 7, target: `[data-request-row="${ids.expense}"]`, can: can6, screen: { page: "requests", sel: null },
      title: "待ちタスクが解除！「着手可能」に切り替え",
      text: "条件がそろえば、自動で「着手可能」に。見逃しがちな後続タスクも安心です。" },
    { ...s6, seconds: 4, target: "#tab-progress", can: can6, screen: { sel: { id: ids.expense, focus: "detail" } },
      title: "理由は「進行」タブで確認",
      text: "経費一覧を開いて、着手に必要な項目を確かめます。" },
    { ...s6, seconds: 6, target: "[data-sec=fields]", can: can6, screen: { sel: { id: ids.expense, focus: "fields" } },
      title: "返信から項目を読み取り済み",
      text: "対象部門と集計単位がそろいました。どの文から読み取ったかも残ります。",
      detail: "返信が来ただけでは「着手可能」になりません。必要な項目がすべてそろったかで判断します。" },
    { ...s6, seconds: 4, target: navTo("今日やること"),
      title: "「今日やること」に戻ります",
      text: "左の「今日やること」を開きます。" },

    // ⑦ 10:05 予定表で作業枠を確保する
    { ...s7, seconds: 6, target: `[data-request-id="${ids.expense}"] .card-buttons .btn:first-child`, can: can7, screen: { page: "today", sel: null },
      title: "空き4時間を発見！作業枠をポンッと予約",
      text: "「空き枠を確認」から、経費一覧に必要な45分が入る枠を選びます。" },
    { ...s7, seconds: 7, target: "[data-sec=slots] .planner .registered-row", can: can7, screen: { sel: { id: ids.expense, focus: "slots" } },
      title: "11:00–11:45 を予定表に登録",
      text: "会議や昼休みと重ならず、期限に間に合う枠だけを提案。登録の前に確認画面が出ます。",
      act: async () => {
        const d = await api.request(ids.expense);
        const c = d.slot_plan.candidates[0];
        if (c && d.work_slots.length === 0) await api.createSlot(ids.expense, c.start, c.end);
        await ctl.refresh();
      } },
    { ...s7, seconds: 4, target: navTo("予定表"),
      title: "左の「予定表」で確かめます",
      text: "登録した作業枠が、予定に入ったかを見ます。" },
    { ...s7, seconds: 6, target: "[data-tour=cal-work]", can: can7, screen: { page: "calendar", sel: null },
      title: "午前の段取り完了です",
      text: "経費一覧と売上資料の作業枠が、別々の予定として並びました。" },

    // ☕ 小休止2：準備と段取り（資料 → 着手可能 → 作業枠）が終わったところ
    { ...s7, kind: "break", time: "小休止", sceneName: "段取り完了", seconds: 12, target: null, mood: "break2",
      title: "段取り完了🎉",
      text: "午前中のうちに、資料と次の仕事の準備が整いました。",
      recap: [
        "出典つきの会議資料のたたき台（3枚）を用意した",
        "不足項目がそろった依頼を「着手可能」にした",
        "空き枠に作業枠を登録した（確認してから）",
      ],
      points: [
        "数値には出典。足りなければ「要確認」にする",
        "状態は「必要な項目がそろったか」で判断する",
        "会議・昼休みと重ならない枠だけを提案する",
      ],
      next: "次は、午後の状況確認と一日の振り返りです。" },

    // ⑧ 15:00 対応状況を確認する
    { ...s8, seconds: 4, target: navTo("今日やること"),
      title: "午後は「今日やること」から",
      text: "売上資料の進み具合を確かめます。" },
    { ...s8, seconds: 4, target: `[data-request-id="${ids.sales}"]`, can: can8, screen: { page: "today", sel: null },
      title: "売上資料を開いて「進行」タブへ",
      text: "行を選ぶと、詳細が開きます。" },
    { ...s8, seconds: 7, target: "[data-sec=progress]", can: can8, screen: { sel: { id: ids.sales, focus: "progress" } },
      title: "午後の進捗も「進行」タブでひと目チェック",
      text: "受信・関連付け・下書きの編集まで、経緯が1画面でスッキリ見渡せます。" },
    { ...s8, seconds: 7, target: ".detail-head-row, [data-sec=status] .status-actions", can: can8, screen: { sel: { id: ids.sales, focus: "status" } },
      title: "終わったら「完了にする」",
      text: "今日の一覧から外れ、「今すぐ対応」は2件に。完了は取り消すこともできます。",
      act: async () => {
        await api.updateRequest(ids.sales, { status: "done" });
        await ctl.refresh();
      } },
    { ...s8, seconds: 4, target: navTo("改善レポート"), screen: { sel: null },
      title: "次は、左の「改善レポート」へ",
      text: "一日の仕事の進め方を振り返ります。" },

    // ⑨ 17:30 今日の仕事を振り返る
    { ...s9, seconds: 7, target: "[data-tour=rp-morning]", can: can9, screen: { page: "report", sel: null },
      title: "朝の段取り 32分 → 9分（サンプル値）",
      text: "改善レポートで、時短の効果と値の出どころを確認できます。数値は架空の例です。",
      detail: "値の出どころは「サンプル値」「このブラウザでの操作時間」「架空の依頼履歴から集計」「実利用の計測値」に分けて表示します。段取り時間には、ツアーを見ている時間は含めません。" },
    { ...s9, seconds: 6, target: "[data-tour=rp-missing]", can: can9,
      title: "抜けやすい項目もひと目で",
      text: "よく抜ける「集計単位」を依頼テンプレートに足せば、確認の往復を減らせます。" },
    { ...s9, seconds: 4, target: ".nav-guide-link:not(.nav-reset)",
      title: "最後に、左下の「実際の業務で使うには」へ",
      text: "本番で使うときの手順を見ます。" },

    // ⑩ 実際の業務で使うには（架空データ・固定ルールの注記をはっきり残す）
    { ...s10, seconds: 8, target: "#real-use-guide .guide-toggle, #real-use-body > .notice", screen: { page: "settings", sel: null, guide: true },
      title: "本番ではMicrosoft 365とつなぐ想定",
      text: "連携は未実装です。このデモは架空データ＋固定ルール（生成AIは未使用）で動いています。",
      detail: "接続すると、席を外している間や夜間も新しい連絡を取り込み、優先順位を見直し続ける想定です（このデモでは時刻を 11/18 9:00 に固定しており、動いていません）。" },
    { ...s10, seconds: 8, target: "#real-use-body ol, [data-tour=guide-perm]",
      title: "導入は4ステップの想定",
      text: "組織の準備 → サインイン → 権限の許可 → 初回同期。管理者の承認が要る場合もあります。",
      detail: "読み取りと、下書き保存・予定登録では必要な権限が異なります。" },

    // ⑪ エンディング（操作するまで表示）
    { ...s11, kind: "ending", seconds: 0, target: null,
      title: "おつかれさま！次は自由に触ってみよう",
      text: "左下の「デモを初期状態に戻す」からいつでもリセットできます。" },
  ];

  // 各拍の「背景の画面」を、直前の拍から引き継いで確定させる。移動のたびに画面全体をそろえる
  let cur: Screen = { page: "today", sel: null, guide: false, breakdown: false };
  return drafts.map(({ screen, ...b }) => {
    cur = { ...cur, ...screen };
    const sc = cur;
    return { ...b, mood: b.mood ?? SCENE_META[b.scene].mood, view: () => applyScreen(ctl, sc) };
  });
}

export const SCENE_COUNT = 11;

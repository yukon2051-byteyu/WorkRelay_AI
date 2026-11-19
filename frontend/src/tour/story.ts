// 5分デモツアーの台本（全11場面＋小休止2回）。あいさつと画面の見方のあと、「青木さんの、ある水曜日」。
// 各「拍（ビート）」は、照らす場所・台詞・読む時間の目安と、
//   act    … ツアー専用データへの操作（関連付け・下書きの編集など）。利用者のデモのデータには触れない
//   screen … 背景の画面（ページ・開いている詳細・内訳の開閉など）。指定しない項目は直前の拍から引き継ぐ
// を持つ。主要な操作は「前」と「後」の拍に分け、操作の結果まで見せる。
// 画面を移る前には、押す場所（サイドバーの項目など）を照らす拍を置き、ツアー後に同じ経路をたどれるようにする。
// 戻るとき・場面を飛ばすときは、ツアー専用データを初期状態に戻して act をやり直し、背景の画面も拍の状態にそろえる。
import { api } from "../api";

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
  kind?: "intro" | "ending" | "break"; // break = 小休止（場面には数えない。ここまでのまとめと見どころ）
  text: string;
  detail?: string; // 「詳しく見る」
  can?: string[]; // この画面でできること（ツアー後に試せる）
  recap?: string[]; // 小休止：ここまでで見たこと
  points?: string[]; // 小休止：WorkRelay AI のポイント（見どころ）
  next?: string; // 小休止：このあと見ること
  act?: () => Promise<void>;
  view?: () => Promise<void> | void; // 背景の画面をそろえる（buildStory が screen から作る）
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
  const sA = S(1, "はじめに", "画面の見方");
  const s1 = S(2, "09:00", "会社に着く");
  const s2 = S(3, "09:02", "昨夜のTeamsを確認する");
  const s3 = S(4, "09:05", "営業への返信を用意する");
  const s4 = S(5, "09:20", "会議資料を準備する");
  const s5 = S(6, "10:00", "別の依頼が着手可能になる");
  const s6 = S(7, "10:05", "予定表で作業枠を確保する");
  const s7 = S(8, "15:00", "対応状況を確認する");
  const s8 = S(9, "17:30", "今日の仕事を振り返る");
  const s9 = S(10, "最後に", "実際の業務で使うには");
  const s10 = S(11, "おわり", "エンディング");

  const can1 = ["並び順を変える（各行の「⋯」→ 上へ／下へ）", "後で確認に回す（「⋯」→ 後で確認、または H キー）", "キーボードで移動（J/K で移動、Enter で開く、Esc で閉じる）"];
  const can2 = ["別の案件として扱う（同じ依頼でなければ、つながない）", "確定期限を変える／そのままにする（つなぐ判断とは別に決める）"];
  const can3 = ["Teamsで送信したことを記録（記録だけ。実際の送信は Teams で行う）", "使わない", "新しい条件で作り直す（編集した本文は残る）"];
  const can4 = ["参照の許可を取り消す／許可する", "作り直す（条件が変わったときは更新確認が出る）", "PowerPoint をダウンロードして編集"];
  const can5 = ["依頼の一覧から、どの依頼でも詳細を開く", "不足項目を手で入力する", "確認文を作る・後で確認"];
  const can6 = ["作業枠の登録を取り消す", "作業時間を入力する（未見積もりのとき）", "時間が足りないときは「速報版を先に出す」「期限を相談する」"];
  const can7 = ["作業を始める／完了を取り消す", "左の「依頼」で、全件の状態を一覧する"];
  const can8 = ["依頼ごとの内訳を開く", "受付テンプレートを変えた前後の比較（サンプル値）を見る"];
  const navTo = (label: string) => `.nav-item[title="${label}"]`; // 画面を移る前に、押す場所として照らすサイドバーの項目

  const drafts: Draft[] = [
    // ① はじめに：あいさつと画面の見方（左で選ぶ・中央で見る・右で根拠を確認する）。短くして、すぐ物語に入る
    { ...sA, kind: "intro", seconds: 8, target: null,
      screen: { page: "today", sel: null, guide: false, breakdown: false },
      text: "はじめまして！WorkRelay AIへようこそ！これから、このアプリについてご案内させていただきます。最初に画面の使い方をさっと紹介して、すぐに青木さんの一日に入りますね。ツアーは自動では進まないので、「次へ」「戻る」で自分のペースで進めてください。「終了」でいつでもやめられます。" },
    { ...sA, seconds: 5, target: ".nav",
      text: "左で、画面を選びます。「今日やること」「依頼」「予定表」「改善レポート」を切り替えます。ツアー中は、表示中の画面の項目も枠で示します。" },
    { ...sA, seconds: 5, target: ".list-pane", screen: { sel: { id: ids.sales } },
      text: "中央で、仕事を見ます。「今日やること」では、対応する順に仕事が並びます。" },
    { ...sA, seconds: 7, target: ".detail-pane",
      text: "右で、根拠を確認します。行を選ぶと詳細が開き、「概要」に次にやること・期限・判断に必要な根拠がまとまります。詳しくは「連絡」「期限」「下書き」などのタブで確かめます。それでは、営業や経理から依頼を受ける青木さんの一日を見ていきましょう！" },

    // ② 09:00 会社に着く
    { ...s1, seconds: 9, target: ".today-head", can: can1, screen: { sel: null },
      text: "おはようございます。出社した青木さんは「今日やること」を開きます。昨夜のOutlookメール・Teams、持ち越しの依頼、今日の予定から、やることが並んでいます。" },
    { ...s1, seconds: 7, target: "[data-tour=breakdown-toggle], #breakdown .breakdown-counts", can: can1, screen: { breakdown: true },
      text: "「取り込みの内訳」を開くと、前回の確認以降に届いた連絡16件が、新規依頼・回答・対応不要・要確認にどう分かれたかが分かります。「今すぐ対応の仕事」は持ち越しも含めた仕事の数なので、16件とは別に数えています。" },
    { ...s1, seconds: 7, target: "#suspicious", can: can1,
      text: "人の確認が必要な連絡は1件だけ、分けて表示しています。対応不要の7件は折りたたんであり、必要なときだけ開けます。上の「要確認」を押すと、この1件を直接開けます。",
      detail: "要確認の1件は、AIへの操作を指示する不審なメールです。本文の指示は実行せず、依頼への登録も保留しています。「元の連絡を確認」で本文を見て判断できます。" },
    { ...s1, seconds: 8, target: '.section[aria-label="今すぐ対応"] .card-top', can: can1, screen: { breakdown: false },
      text: "「今すぐ対応」の先頭は、営業への返信です。会議の前倒しを相談されて相手が答えを待っているため、期限の近い作業より先に並びました。",
      detail: "並び順はデモの固定ルールで決めています（条件の変更・相手が待っている確認・期限の近さ・空き時間）。生成AIは使っていません。" },
    { ...s1, seconds: 6, target: '.section[aria-label="今日の空き時間で進める"]', can: can1,
      text: "空き時間で進められる仕事は、その下にまとまります。並び順の変更や「後で確認」は、各行の「⋯」から青木さん自身が調整できます。" },

    // ③ 09:02 昨夜のTeamsを確認する（概要の「同じ依頼ですか？」→ 原文と判定理由 → 概要に戻って判断）
    { ...s2, seconds: 9, target: "[data-sec=candidate] .msg.candidate, [data-sec=summary] .due-line", can: can2, screen: { sel: { id: ids.sales, focus: "candidate" } },
      text: "昨夜、営業から会議の前倒しを相談されました。「概要」の「同じ依頼ですか？」に、このTeamsの連絡の要点が抜き出されています。希望は今日11:00（確認前）、引き受け済みの確定期限は今日15:00です。" },
    { ...s2, seconds: 5, target: "[data-sec=candidate] .decide-more", can: can2,
      text: "全文と、同じ依頼の候補とした理由は「原文と判定理由を見る」で確かめられます。開いてみましょう。" },
    { ...s2, seconds: 8, target: "[data-sec=candidate-source]", can: can2, screen: { sel: { id: ids.sales, focus: "candidate-source" } },
      text: "「連絡」タブに、Teamsの全文と、候補と判断した理由が表示されました。同じ依頼者・依頼名の語・メールで送った依頼への言及が手がかりです。" },
    { ...s2, seconds: 7, target: "[data-sec=evidence] .msg", can: can2, screen: { sel: { id: ids.sales, focus: "evidence" } },
      text: "その下が、昨日のOutlookの元の依頼です。売上資料を「明日15:00まで」に、という内容でした。" },
    { ...s2, seconds: 4, target: "#tab-overview", can: can2,
      text: "判断は「概要」タブに戻って行います。" },
    { ...s2, seconds: 8, target: "[data-sec=candidate] .impact, [data-sec=candidate] .btn-row", can: can2, screen: { sel: { id: ids.sales, focus: "candidate" } },
      text: "つないでも確定期限は今日15:00のまま、という影響がボタンの上に書かれています。同じ依頼なら「同じ依頼としてつなぐ」、別件なら「別の案件として扱う」。判断するのは青木さんです。" },
    { ...s2, seconds: 8, target: "[data-sec=summary] .due-line, [data-sec=decided]", can: can2, screen: { sel: { id: ids.sales, focus: "summary" } },
      text: "青木さんは同じ依頼としてつなぎました。今日11:00は希望期限（前倒しの相談中）として記録されましたが、引き受け済みの確定期限は今日15:00のままです。",
      detail: "つなぐ判断と、期限を変える判断は別です。期限を変えるときは「期限」タブの「確定期限を変更」を青木さんが選びます。",
      act: async () => {
        const d = await api.request(ids.sales);
        const c = d.candidates.find((x) => x.status === "pending");
        if (c) await api.acceptCandidate(c.id);
        await ctl.refresh();
      } },

    // ④ 09:05 営業への返信を用意する（「？」の説明は、実際に使うこの場面で紹介する）
    { ...s3, seconds: 9, target: ".next-box", can: can3,
      text: "11時までの空きは30分。確定版には60分必要です。そこで青木さんは、速報版で足りるかを先に確認します。見出しの横の「？」を押すと、その欄の説明が開きます。" },
    { ...s3, seconds: 4, target: "#tab-due", can: can3,
      text: "空き時間を予定表で確かめます。「期限」タブを開きます。" },
    { ...s3, seconds: 9, target: "[data-sec=slots] .timeline .tl-row:nth-child(-n+4)", can: can3, screen: { sel: { id: ids.sales, focus: "slots" } },
      text: "予定表と見比べると、11:00までに空いているのは9:00–9:30の30分だけ。9:30からは会議が続きます。" },
    { ...s3, seconds: 4, target: "#tab-draft", can: can3,
      text: "返信案は「下書き」タブにあります。" },
    { ...s3, seconds: 9, target: "[data-sec=draft] .draft textarea", can: can3, screen: { sel: { id: ids.sales, focus: "draft" } },
      text: "返信案には「11時までに速報版、確定版は15時まで」の提案が入っています。青木さんは一文を書き足しました。",
      act: async () => {
        const d = (await api.request(ids.sales)).drafts.find((x) => x.kind === "due_adjust");
        if (d && !d.body.includes("見たい数字")) {
          await api.editDraft(d.id, d.body.replace("ご確認いただけますか。", "ご確認いただけますか。会議で特に見たい数字があれば教えてください。"));
        }
        await ctl.refresh();
      } },
    { ...s3, seconds: 8, target: "[data-sec=draft] .draft .btn-row", can: can3,
      text: "Teamsへは、コピーしてTeamsで送ります。Outlook宛ての返信なら「Outlookに下書きを保存」も使えます。デモではアプリ内に記録します。実際のOutlookには保存されません。コピーや保存をしても、送信はされません。",
      act: async () => {
        const d = (await api.request(ids.sales)).drafts.find((x) => x.kind === "due_adjust");
        if (d) await api.draftAction(d.id, "copy");
      } },

    // ☕ 小休止1：朝の整理（取り込み → 関連付け → 返信）が終わったところで区切る
    { ...s3, kind: "break", time: "小休止", sceneName: "朝の整理のまとめ", seconds: 15, target: null,
      text: "ここでひと息つきましょう。出社してから5分ほどで、青木さんは朝の整理を終えました。",
      recap: [
        "夜間に届いた連絡16件を分類し、確認が必要な1件を分けて、最初に対応する仕事を決めた",
        "Teamsの前倒しの相談を、昨日のOutlookの依頼と同じ案件としてつないだ",
        "空き30分と必要60分を比べて、「速報版を先に出す」返信案を用意した",
      ],
      points: [
        "確定期限と希望期限を分けて表示。前倒しの相談が来ても、確定期限は勝手に変えない",
        "関連候補には、原文の抜粋と判断した理由を表示。つなぐかどうかを決めるのは人",
        "送信は人の操作から。編集した返信は、作り直しても上書きしない",
      ],
      next: "このあとは、会議資料の準備と、別の依頼の段取りを見ます。" },

    // ⑤ 09:20 会議資料を準備する
    { ...s4, seconds: 4, target: "#tab-document", can: can4,
      text: "次は会議資料です。「資料」タブを開きます。" },
    { ...s4, seconds: 8, target: "[data-sec=document] .slides", can: can4, screen: { sel: { id: ids.sales, focus: "document" } },
      text: "先に用意されたたたき台を開きます。概要・数字と変化・会議で確認したいことの3枚です。" },
    { ...s4, seconds: 9, target: "[data-sec=document] .slide:nth-child(2) .slide-table", can: can4,
      text: "数字を一つ見てみます。法人営業部の10月は4,659万円、前月比+16.9%。会議では、この伸びが続くかを確認したいところです。" },
    { ...s4, seconds: 9, target: "[data-sec=document] .evidence-grid", can: can4,
      text: "この数字の出典は、架空の売上Excel「2026年度_売上実績.xlsx」、シート「売上実績」、2026年10月と9月の24行です。参照を許可したファイルだけを読みます。" },
    { ...s4, seconds: 9, target: "[data-sec=document] .btn-row a.btn.primary", can: can4,
      text: "元データが足りないときは、数値を「要確認」にして構成だけを用意します。編集できるPowerPointは、ツアーの後にダウンロードできます。" },
    { ...s4, seconds: 4, target: navTo("依頼"),
      text: "次は、ほかの依頼の状況を見ます。左の「依頼」を開きます。" },

    // ⑥ 10:00 別の依頼が着手可能になる
    { ...s5, seconds: 9, target: `[data-request-row="${ids.expense}"]`, can: can5, screen: { page: "requests", sel: null },
      text: "「依頼」の一覧です。経費一覧は「着手可能」になっています。行を選んで詳細を開きます。" },
    { ...s5, seconds: 4, target: "#tab-progress", can: can5, screen: { sel: { id: ids.expense, focus: "detail" } },
      text: "経費一覧の詳細が開きました。着手に必要な項目は「進行」タブで確かめます。" },
    { ...s5, seconds: 9, target: "[data-sec=fields]", can: can5, screen: { sel: { id: ids.expense, focus: "fields" } },
      text: "昨夜の返信で、不足していた対象部門と集計単位が分かりました。どの文から読み取ったかも、根拠として残っています。" },
    { ...s5, seconds: 9, target: "[data-sec=progress]", can: can5, screen: { sel: { id: ids.expense, focus: "progress" } },
      text: "必要な項目がすべてそろったので「着手可能」になりました。返信が来ただけでは変わらず、項目がそろったかで判断します。" },
    { ...s5, seconds: 4, target: navTo("今日やること"),
      text: "「今日やること」に戻ります。左の「今日やること」を開きます。" },
    { ...s5, seconds: 8, target: `[data-request-id="${ids.budget}"] .card-buttons`, can: can5, screen: { page: "today", sel: null },
      text: "情報が足りない依頼では「確認文を作る」、すぐに扱わない依頼では「⋯」の「後で確認」を選べます。" },

    // ⑦ 10:05 予定表で作業枠を確保する
    { ...s6, seconds: 4, target: `[data-request-id="${ids.expense}"] .card-buttons .btn:first-child`, can: can6,
      text: "経費一覧の作業時間を確保します。「空き枠を確認」を押すと、詳細の「期限」タブが開きます。" },
    { ...s6, seconds: 9, target: "[data-sec=slots] .planner", can: can6, screen: { sel: { id: ids.expense, focus: "slots" } },
      text: "経費一覧に必要な45分が入る空き枠の候補です。会議や昼休みと重ならず、期限の11/20に間に合う枠が早い順に並びます。" },
    { ...s6, seconds: 10, target: "[data-sec=slots] .planner .registered-row", can: can6,
      text: "青木さんは今日11:00–11:45を選び、デモ内の予定表に登録しました。実際の操作では、登録の前に反映先と日時を確認する画面が出ます。",
      act: async () => {
        const d = await api.request(ids.expense);
        const c = d.slot_plan.candidates[0];
        if (c && d.work_slots.length === 0) await api.createSlot(ids.expense, c.start, c.end);
        await ctl.refresh();
      } },
    { ...s6, seconds: 4, target: navTo("予定表"),
      text: "登録した作業枠を、予定表で確かめます。左の「予定表」を開きます。" },
    { ...s6, seconds: 11, target: "[data-tour=cal-work]", can: can6, screen: { page: "calendar", sel: null },
      text: "予定表には、経費一覧の11:00–11:45と、売上資料の13:30–14:30が、別々の作業枠として並びます。" },

    // ☕ 小休止2：準備と段取り（資料 → 着手可能 → 作業枠）が終わったところで区切る
    { ...s6, kind: "break", time: "小休止", sceneName: "準備と段取りのまとめ", seconds: 15, target: null,
      text: "2回目の小休止です。午前中のうちに、会議資料と次の仕事の段取りが整いました。",
      recap: [
        "参照を許可した売上Excelから、編集できる会議資料のたたき台（3枚）を用意した",
        "昨夜の返信から不足していた項目を読み取り、経費一覧を「着手可能」にした",
        "必要な時間と期限から空き枠を提案し、確認のうえで予定表に作業枠を登録した",
      ],
      points: [
        "資料の数値には出典（ファイル・シート・行）。データが足りなければ「要確認」にする",
        "状態は「返信が来たか」ではなく「必要な項目がそろったか」で判断する",
        "会議や昼休みと重ならず、期限に間に合う枠だけを提案する。登録は確認してから",
      ],
      next: "このあとは、午後の対応状況の確認と、一日の振り返りを見ます。" },

    // ⑧ 15:00 対応状況を確認する（予定表から「今日やること」へ戻る）
    { ...s7, seconds: 4, target: navTo("今日やること"),
      text: "午後です。左の「今日やること」に戻って、売上資料の状況を確認します。" },
    { ...s7, seconds: 4, target: `[data-request-id="${ids.sales}"]`, can: can7, screen: { page: "today", sel: null },
      text: "売上資料の行を選び、詳細の「進行」タブで履歴を確かめます。" },
    { ...s7, seconds: 10, target: "[data-sec=progress]", can: can7, screen: { sel: { id: ids.sales, focus: "progress" } },
      text: "確定版を仕上げた青木さんは、売上資料の履歴を確認します。受信、関連付け、下書きの編集などが順に記録されています。" },
    { ...s7, seconds: 8, target: "[data-sec=status] .status-actions", can: can7, screen: { sel: { id: ids.sales, focus: "status" } },
      text: "対応が終わったので、「進行」タブの「完了にする」を押します。" },
    { ...s7, seconds: 12, target: ".detail-head-row, .stats .stat:first-child", can: can7,
      text: "状態が「完了」になり、売上資料は今日の一覧から外れました。「今すぐ対応」は3件から2件に減っています。完了は取り消すこともできます。",
      act: async () => {
        await api.updateRequest(ids.sales, { status: "done" });
        await ctl.refresh();
      } },
    { ...s7, seconds: 4, target: navTo("改善レポート"), screen: { sel: null },
      text: "一日の終わりに、仕事の進め方を振り返ります。左の「改善レポート」を開きます。" },

    // ⑨ 17:30 今日の仕事を振り返る
    { ...s8, seconds: 8, target: "[data-tour=rp-morning]", can: can8, screen: { page: "report", sel: null },
      text: "改善レポートです。値の出どころは「サンプル値」「このブラウザでの操作時間」「架空の依頼履歴から集計」「実利用の計測値」に分けて表示します。段取り時間には、このツアーを見ている時間は含めません。" },
    { ...s8, seconds: 8, target: "[data-tour=rp-flow]", can: can8,
      text: "どこで確認の往復が増えたか、着手できるまで何時間かかったかを、依頼の種類ごとに件数つきで見られます。" },
    { ...s8, seconds: 8, target: "[data-tour=rp-missing]", can: can8,
      text: "初回の依頼で抜けやすい項目も分かります。このデモでは「集計単位」がよく抜けています。よく抜ける項目を依頼テンプレートに足せば、確認の往復を減らせます。",
      detail: "「受付テンプレートを変えた前後の比較」は架空のサンプル値で、対象部門の欄を足した前後の変化の例を示しています。" },
    { ...s8, seconds: 4, target: ".nav-guide-link:not(.nav-reset)",
      text: "最後に、実際の業務で使うときの手順を見ます。次は、左下の「実際の業務で使うには」を開きます。" },

    // ⑩ 実際の業務で使うには（離席中・夜間も動き続ける想定も、ここでまとめて伝える）
    { ...s9, seconds: 12, target: "#real-use-guide", screen: { page: "settings", sel: null, guide: true },
      text: "ここまでは架空データの公開デモです。実際の業務で使うには、会社のMicrosoft 365環境で接続を設定します。" },
    { ...s9, seconds: 13, target: "#real-use-body ol, [data-tour=guide-perm]",
      text: "組織側の準備 → 職場アカウントでサインイン → 権限の許可（管理者の承認が必要な場合あり）→ 初回同期の順です。読み取りと、下書き保存・予定登録では必要な権限が異なります。" },
    { ...s9, seconds: 9, target: "#real-use-guide",
      text: "接続すると、青木さんが席を外している間や夜間も、新しい連絡の取り込みと優先順位の見直しを続け、戻ったときには最新の「今日やること」から始められる想定です（このデモでは未実装）。",
      detail: "このデモでは時刻を 11/18 9:00 に固定しており、離席中・夜間の自動取り込みは動いていません。取り込みや判断の仕組みそのものは、朝の場面で見たものと同じです。" },

    // ⑪ エンディング（操作するまで表示）
    { ...s10, kind: "ending", seconds: 0, target: null,
      text: "これで、デモツアーは終了です。青木さんは、朝の仕事の整理から、返信や資料の準備、予定の調整、一日の振り返りまでをWorkRelay AIで進めました。ここからは、気になった機能をご自身のペースでお試しください。" },
  ];

  // 各拍の「背景の画面」を、直前の拍から引き継いで確定させる。移動のたびに画面全体をそろえる
  let cur: Screen = { page: "today", sel: null, guide: false, breakdown: false };
  return drafts.map(({ screen, ...b }) => {
    cur = { ...cur, ...screen };
    const sc = cur;
    return { ...b, view: () => applyScreen(ctl, sc) };
  });
}

export const SCENE_COUNT = 11;

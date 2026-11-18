// 5分デモツアーの台本（全13場面＋小休止2回）。最初に画面の見方、続いて「青木さんの、ある水曜日」。
// 各「拍（ビート）」は、照らす場所・台詞・表示時間（画面が落ち着いてからの秒数）と、
//   act  … ツアー専用データへの操作（関連付け・下書きの編集など）。利用者のデモのデータには触れない
//   view … 画面の切り替え（ページ移動・詳細を開くなど）。データは変えない
// を持つ。主要な操作は「前」と「後」の拍に分け、操作の結果まで見せる。
// 戻るときは、ツアー専用データを初期状態に戻してから act をやり直すので、画面とデータが食い違わない。
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
  seconds: number; // 読む時間の目安（自動では進まない。全体で「目安5分」を見積もるためだけに使う）
  target: string | null; // 照らす場所（null は画面中央に表示。注目枠は出さない）
  kind?: "intro" | "ending" | "break"; // break = 小休止（場面には数えない。ここまでのまとめと見どころ）
  text: string;
  detail?: string; // 「詳しく見る」
  can?: string[]; // この画面でできること（ツアー後に試せる）
  recap?: string[]; // 小休止：ここまでで見たこと
  points?: string[]; // 小休止：WorkRelay AI のポイント（見どころ）
  next?: string; // 小休止：このあと見ること
  act?: () => Promise<void>;
  view?: () => Promise<void> | void;
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

export function buildStory(ctl: TourCtl, ids: Ids): Beat[] {
  const S = (scene: number, time: string, sceneName: string) => ({ scene, time, sceneName });
  const sA = S(1, "はじめに", "画面の見方");
  const s0 = S(2, "導入", "青木さんの一日");
  const s1 = S(3, "09:00", "会社に着く");
  const s2 = S(4, "09:02", "昨夜のTeamsを確認する");
  const s3 = S(5, "09:05", "営業への返信を用意する");
  const s4 = S(6, "09:20", "会議資料を準備する");
  const s5 = S(7, "10:00", "別の依頼が着手可能になる");
  const s6 = S(8, "10:05", "予定表で作業枠を確保する");
  const sL = S(9, "12:00", "お昼休憩");
  const s7 = S(10, "15:00", "対応状況を確認する");
  const s8 = S(11, "17:30", "今日の仕事を振り返る");
  const s9 = S(12, "最後に", "実際の業務で使うには");
  const s10 = S(13, "おわり", "エンディング");

  const can1 = ["並び順を変える（各行の「⋯」→ 上へ／下へ）", "後で確認に回す（「⋯」→ 後で確認、または H キー）", "キーボードで移動（J/K で移動、Enter で開く、Esc で閉じる）"];
  const can2 = ["別の案件として扱う（同じ依頼でなければ、つながない）", "確定期限を変える／そのままにする（つなぐ判断とは別に決める）"];
  const can3 = ["Teamsで送信したことを記録（記録だけ。実際の送信は Teams で行う）", "使わない", "新しい条件で作り直す（編集した本文は残る）"];
  const can4 = ["参照の許可を取り消す／許可する", "作り直す（条件が変わったときは更新確認が出る）", "PowerPoint をダウンロードして編集"];
  const can5 = ["依頼の一覧から、どの依頼でも詳細を開く", "不足項目を手で入力する", "確認文を作る・後で確認"];
  const can6 = ["作業枠の登録を取り消す", "作業時間を入力する（未見積もりのとき）", "時間が足りないときは「速報版を先に出す」「期限を相談する」"];
  const can7 = ["作業を始める／完了を取り消す", "左の「依頼」で、全件の状態を一覧する"];
  const can8 = ["依頼ごとの内訳を開く", "受付テンプレートを変えた前後の比較（サンプル値）を見る"];

  return [
    // ① はじめに：画面の見方（各エリアの役割を先に知ってから、物語に入る）
    { ...sA, kind: "intro", seconds: 10, target: null,
      text: "はじめまして！WorkRelay AIへようこそ！これから、このアプリについてご案内させていただきます。まずは画面の各エリアの役割を紹介して、そのあと青木さんの一日を一緒に見ていきましょう。ツアーは自動では進まないので、「次へ」「戻る」で自分のペースで進めてくださいね。「終了」でいつでもやめられます。",
      view: () => { ctl.guide(false); ctl.page("today"); ctl.select(null); } },
    { ...sA, seconds: 7, target: ".nav",
      text: "左のサイドバーで、画面を切り替えます。「今日やること」「依頼」「予定表」「改善レポート」、下に「接続設定」があります。ツアー中も、いま表示している画面の項目を枠で示します。",
      view: () => { ctl.page("today"); ctl.select(null); } },
    { ...sA, seconds: 6, target: ".demo-bar",
      text: "上の帯は、デモの前提です。架空データであること、依頼の抽出や優先順位は固定ルールで判定していること（生成AIは未使用）、時刻を固定していることを示します。右端で表示テーマを切り替え、デモツアーをいつでも始められます。" },
    { ...sA, seconds: 7, target: ".list-pane",
      text: "中央は、いま開いている画面の本体です。「今日やること」では、対応する順に仕事が並び、上に件数・要確認・今日の空き時間がまとまっています。",
      view: () => { ctl.page("today"); ctl.select(ids.sales); } },
    { ...sA, seconds: 7, target: ".detail-pane",
      text: "一覧の行を選ぶと、右に依頼の詳細が開きます。先頭の「次にやること」と、元の連絡・期限と予定表・下書き・資料・進行の順に、判断に必要な情報がまとまっています。",
      view: () => ctl.select(ids.sales) },
    { ...sA, seconds: 5, target: ".detail-pane [data-help=next] .help-icon",
      text: "見出しの横の「？」を押すと、その欄の説明が開きます。ツアーの後も、迷ったときに使えます。",
      view: () => ctl.select(ids.sales) },

    // ② 導入
    { ...s0, seconds: 8, target: null,
      text: "それでは、青木さんの一日を見ていきましょう。営業や経理から依頼を受ける青木さんが、昨夜の連絡を整理し、返信や資料を準備して、一日の仕事を振り返ります。気になった画面では足を止めて、判断の根拠まで読んでください。",
      view: () => { ctl.guide(false); ctl.page("today"); ctl.select(null); } },

    // ③ 09:00 会社に着く（30秒）
    { ...s1, seconds: 9, target: ".today-head", can: can1,
      text: "おはようございます。出社した青木さんは「今日やること」を開きます。昨夜のOutlookメール・Teams、持ち越しの依頼、今日の予定から、やることが並んでいます。" },
    { ...s1, seconds: 7, target: "[data-tour=breakdown-toggle], #breakdown .breakdown-counts", can: can1,
      text: "「取り込みの内訳」を開くと、夜間の連絡16件が、新規依頼・回答・対応不要・要確認にどう分かれたかが分かります。",
      detail: "要確認の1件は、AIへの操作を指示する不審なメールです。本文の指示は実行せず、依頼にもしていません。",
      view: () => click("[data-tour=breakdown-toggle]", true) },
    { ...s1, seconds: 8, target: '.section[aria-label="今すぐ対応"] .card-top', can: can1,
      text: "「今すぐ対応」の先頭は、営業への返信です。会議の前倒しを相談されて相手が答えを待っているため、期限の近い作業より先に並びました。",
      detail: "並び順はデモの固定ルールで決めています（条件の変更・相手が待っている確認・期限の近さ・空き時間）。生成AIは使っていません。",
      view: () => click("[data-tour=breakdown-toggle]", false) },
    { ...s1, seconds: 6, target: '.section[aria-label="今日の空き時間で進める"]', can: can1,
      text: "空き時間で進められる仕事は、その下にまとまります。並び順の変更や「後で確認」は、各行の「⋯」から青木さん自身が調整できます。" },

    // ④ 09:02 昨夜のTeamsを確認する（38秒）
    { ...s2, seconds: 9, target: "[data-sec=candidate] .msg.candidate", can: can2,
      text: "昨夜、営業から会議の前倒しを相談されました。このTeamsの連絡は、昨日Outlookで受けた依頼と同じでしょうか。",
      view: () => ctl.select(ids.sales, "candidate") },
    { ...s2, seconds: 7, target: "[data-sec=evidence] .msg", can: can2,
      text: "こちらが昨日のOutlookの元の依頼です。売上資料を「明日15:00まで」に、という内容でした。",
      view: () => ctl.select(ids.sales, "evidence") },
    { ...s2, seconds: 8, target: "[data-sec=candidate] .reasons, [data-sec=candidate] .btn-row", can: can2,
      text: "同じ案件の候補とした理由です。同じ依頼なら「同じ依頼としてつなぐ」、別件なら「別の案件として扱う」を選びます。判断するのは青木さんです。",
      view: () => ctl.select(ids.sales, "candidate") },
    { ...s2, seconds: 6, target: "[data-sec=slots] .due-grid", can: can2,
      text: "つなぐ前の期限です。今日11:00は「変更候補（Teams・確認前）」、引き受け済みの確定期限は今日15:00です。",
      view: () => ctl.select(ids.sales, "slots") },
    { ...s2, seconds: 8, target: "[data-sec=slots] .due-grid", can: can2,
      text: "青木さんは同じ依頼としてつなぎました。今日11:00は依頼者の希望として記録されましたが、引き受け済みの期限は今日15:00のままです。",
      detail: "つなぐ判断と、期限を変える判断は別です。期限を変えるときは「確定期限を変更」を青木さんが選びます。",
      act: async () => {
        const d = await api.request(ids.sales);
        const c = d.candidates.find((x) => x.status === "pending");
        if (c) await api.acceptCandidate(c.id);
        await ctl.refresh();
      } },

    // ⑤ 09:05 営業への返信を用意する（35秒）
    { ...s3, seconds: 9, target: ".next-box", can: can3,
      text: "11時までの空きは30分。確定版には60分必要です。そこで青木さんは、速報版で足りるかを先に確認します。",
      view: () => ctl.select(ids.sales, "status") },
    { ...s3, seconds: 9, target: "[data-sec=slots] .timeline .tl-row:nth-child(-n+4)", can: can3,
      text: "予定表と見比べると、11:00までに空いているのは9:00–9:30の30分だけ。9:30からは会議が続きます。",
      view: () => ctl.select(ids.sales, "slots") },
    { ...s3, seconds: 9, target: "[data-sec=draft] .draft textarea", can: can3,
      text: "返信案には「11時までに速報版、確定版は15時まで」の提案が入っています。青木さんは一文を書き足しました。",
      act: async () => {
        const d = (await api.request(ids.sales)).drafts.find((x) => x.kind === "due_adjust");
        if (d && !d.body.includes("見たい数字")) {
          await api.editDraft(d.id, d.body.replace("ご確認いただけますか。", "ご確認いただけますか。会議で特に見たい数字があれば教えてください。"));
        }
        await ctl.refresh();
      },
      view: () => ctl.select(ids.sales, "draft") },
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
        "夜間の連絡16件を、新規依頼・回答・対応不要・要確認に分け、最初に対応する仕事を決めた",
        "Teamsの前倒しの相談を、昨日のOutlookの依頼と同じ案件の候補として示し、青木さんがつないだ",
        "空き30分と必要60分を比べて、「速報版を先に出す」返信案を用意した",
      ],
      points: [
        "確定期限と希望期限を分けて表示。前倒しの相談が来ても、確定期限は勝手に変えない",
        "並び順や関連候補には、理由と根拠を表示。最後に判断するのは人",
        "送信・保存は人の操作から。編集した返信は、作り直しても上書きしない",
      ],
      next: "このあとは、会議資料の準備と、別の依頼の段取りを見ます。",
      view: () => ctl.select(null) },

    // ⑥ 09:20 会議資料を準備する（35秒）
    { ...s4, seconds: 8, target: "[data-sec=document] .slides", can: can4,
      text: "先に用意されたたたき台を開きます。概要・数字と変化・会議で確認したいことの3枚です。",
      view: () => ctl.select(ids.sales, "document") },
    { ...s4, seconds: 9, target: "[data-sec=document] .slide:nth-child(2) .slide-table", can: can4,
      text: "数字を一つ見てみます。法人営業部の10月は4,659万円、前月比+16.9%。会議では、この伸びが続くかを確認したいところです。" },
    { ...s4, seconds: 9, target: "[data-sec=document] .evidence-grid", can: can4,
      text: "この数字の出典は、架空の売上Excel「2026年度_売上実績.xlsx」、シート「売上実績」、2026年10月と9月の24行です。参照を許可したファイルだけを読みます。" },
    { ...s4, seconds: 9, target: "[data-sec=document] .btn-row a.btn.primary", can: can4,
      text: "元データが足りないときは、数値を「要確認」にして構成だけを用意します。編集できるPowerPointは、ツアーの後にダウンロードできます。" },

    // ⑦ 10:00 別の依頼が着手可能になる（35秒）
    { ...s5, seconds: 9, target: `[data-request-row="${ids.expense}"]`, can: can5,
      text: "左の「依頼」で一覧を開きます。経費一覧は「着手可能」になっています。",
      view: () => { ctl.select(null); ctl.page("requests"); } },
    { ...s5, seconds: 9, target: "[data-sec=fields]", can: can5,
      text: "昨夜の返信で、不足していた対象部門と集計単位が分かりました。どの文から読み取ったかも、根拠として残っています。",
      view: () => ctl.select(ids.expense, "fields") },
    { ...s5, seconds: 9, target: "[data-sec=progress]", can: can5,
      text: "必要な項目がすべてそろったので「着手可能」になりました。返信が来ただけでは変わらず、項目がそろったかで判断します。",
      view: () => ctl.select(ids.expense, "progress") },
    { ...s5, seconds: 8, target: `[data-request-id="${ids.budget}"] .card-buttons`, can: can5,
      text: "情報が足りない依頼では「確認文を作る」、すぐに扱わない依頼では「⋯」の「後で確認」を選べます。",
      view: () => { ctl.select(null); ctl.page("today"); } },

    // ⑧ 10:05 予定表で作業枠を確保する（30秒）
    { ...s6, seconds: 9, target: "[data-sec=slots] .planner", can: can6,
      text: "経費一覧に必要な45分が入る空き枠の候補です。会議や昼休みと重ならず、期限の11/20に間に合う枠が早い順に並びます。",
      view: () => ctl.select(ids.expense, "slots") },
    { ...s6, seconds: 10, target: "[data-sec=slots] .planner .registered-row", can: can6,
      text: "青木さんは今日11:00–11:45を選び、デモ内の予定表に登録しました。実際の操作では、登録の前に反映先と日時を確認する画面が出ます。",
      act: async () => {
        const d = await api.request(ids.expense);
        const c = d.slot_plan.candidates[0];
        if (c && d.work_slots.length === 0) await api.createSlot(ids.expense, c.start, c.end);
        await ctl.refresh();
      } },
    { ...s6, seconds: 11, target: "[data-tour=cal-work]", can: can6,
      text: "予定表には、経費一覧の11:00–11:45と、売上資料の13:30–14:30が、別々の作業枠として並びます。",
      view: () => { ctl.select(null); ctl.page("calendar"); } },

    // ☕ 小休止2：準備と段取り（資料 → 着手可能 → 作業枠）が終わったところで区切る
    { ...s6, kind: "break", time: "小休止", sceneName: "準備と段取りのまとめ", seconds: 15, target: null,
      text: "ここで2回目の小休止です。午前中のうちに、会議資料と次の仕事の段取りが整いました。",
      recap: [
        "参照を許可した売上Excelから、編集できる会議資料のたたき台（3枚）を用意した",
        "昨夜の返信から不足していた項目を読み取り、経費一覧を「着手可能」にした",
        "必要な時間と期限から空き枠を提案し、確認のうえで予定表に作業枠を登録した",
      ],
      points: [
        "資料の数値には出典（ファイル・シート・行）。データが足りなければ「要確認」にする",
        "状態は「返信が来たか」ではなく「必要な項目がそろったか」で判断する",
        "会議や昼休みと重ならず、期限に間に合う枠だけを提案する",
      ],
      next: "最後に、一日の振り返り（改善レポート）と、実際の業務で使うときの手順を見ます。",
      view: () => { ctl.page("today"); ctl.select(null); } },

    // ⑨ 12:00 お昼休憩：人が働いていない時間も、アシスタントは動き続ける（実連携後の想定。デモでは未実装）
    { ...sL, seconds: 12, target: ".today-head",
      text: "12:00、青木さんはお昼休憩です。席を外している間も、WorkRelay AIはメールやTeamsの新しい連絡を確認し、依頼の抽出や「今日やること」の優先順位を見直し続けます。戻ったときには、最新の状態から午後の仕事を始められます（Microsoft 365 と実連携したときの想定で、このデモでは未実装です）。",
      detail: "これは Microsoft 365 と実連携したときの想定です。このデモでは時刻を 11/18 9:00 に固定しており、離席中の自動取り込みは動いていません（未実装）。取り込みや判断の仕組みそのものは、朝の場面で見たものと同じです。",
      view: () => { ctl.page("today"); ctl.select(null); } },

    // ⑩ 15:00 対応状況を確認する（30秒）
    { ...s7, seconds: 10, target: "[data-sec=progress]", can: can7,
      text: "確定版を仕上げた青木さんは、売上資料の履歴を確認します。受信、関連付け、下書きの編集などが順に記録されています。",
      view: () => { ctl.page("today"); ctl.select(ids.sales, "progress"); } },
    { ...s7, seconds: 8, target: "[data-sec=status]", can: can7,
      text: "対応が終わったので「完了にする」を押します。",
      view: () => ctl.select(ids.sales, "status") },
    { ...s7, seconds: 12, target: ".detail-head-row, .stats .stat:first-child", can: can7,
      text: "状態が「完了」になり、売上資料は今日の一覧から外れました。「今すぐ対応」は3件から2件に減っています。完了は取り消すこともできます。",
      act: async () => {
        await api.updateRequest(ids.sales, { status: "done" });
        await ctl.refresh();
      } },

    // ⑪ 17:30 今日の仕事を振り返る（24秒）
    { ...s8, seconds: 8, target: "[data-tour=rp-morning]", can: can8,
      text: "一日の終わりに、改善レポートで振り返ります。値の出どころは「サンプル値」「このブラウザでの操作時間」「架空の依頼履歴から集計」「実利用の計測値」に分けて表示します。段取り時間には、このツアーを見ている時間は含めません。",
      view: () => { ctl.select(null); ctl.page("report"); } },
    { ...s8, seconds: 8, target: "[data-tour=rp-flow]", can: can8,
      text: "どこで確認の往復が増えたか、着手できるまで何時間かかったかを、依頼の種類ごとに件数つきで見られます。" },
    { ...s8, seconds: 8, target: "[data-tour=rp-missing]", can: can8,
      text: "初回の依頼で抜けやすい項目も分かります。このデモでは「集計単位」がよく抜けています。よく抜ける項目を依頼テンプレートに足せば、確認の往復を減らせます。",
      detail: "「受付テンプレートを変えた前後の比較」は架空のサンプル値で、対象部門の欄を足した前後の変化の例を示しています。" },

    // ⑫ 実際の業務で使うには（25秒）
    { ...s9, seconds: 12, target: "#real-use-guide",
      text: "ここまでは架空データの公開デモです。実際の業務で使うには、会社のMicrosoft 365環境で接続を設定します。",
      view: () => { ctl.page("settings"); ctl.guide(true); } },
    { ...s9, seconds: 13, target: "#real-use-body ol, [data-tour=guide-perm]",
      text: "組織側の準備 → 職場アカウントでサインイン → 権限の許可（管理者の承認が必要な場合あり）→ 初回同期の順です。読み取りと、下書き保存・予定登録では必要な権限が異なります。" },

    // ⑬ エンディング（操作するまで表示）
    { ...s10, kind: "ending", seconds: 0, target: null,
      text: "これで、デモツアーは終了です。青木さんは、朝の仕事の整理から、返信や資料の準備、予定の調整、一日の振り返りまでをWorkRelay AIで進めました。ここからは、気になった機能をご自身のペースでお試しください。" },
  ];
}

export const SCENE_COUNT = 13;

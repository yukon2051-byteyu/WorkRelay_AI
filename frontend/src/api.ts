// バックエンド API の呼び出しと、受け取るデータの型

export type Prep = { label: string; kind: "ok" | "warn" | "info" };
export type Action = { label: string; target: string };
export type Evidence = {
  message_id: number;
  channel: "outlook" | "teams";
  sender_name: string;
  received_at: string;
  role: string;
  snippet: string;
};
export type Card = {
  request_id: number;
  title: string;
  requester_name: string;
  status: string;
  section: string;
  score: number;
  next_action: string;
  why_now: string[];
  prep: Prep[];
  due: { requested: string | null; committed: string | null; proposed: string | null; change_status: string | null };
  effort_minutes: number | null;
  evidence: Evidence[];
  capacity: { until: string; free_minutes: number; need_minutes: number | null } | null;
  has_document: boolean;
  primary_action: Action;
  secondary_actions: Action[];
};
export type Section = { key: string; label: string; items: Card[] };
export type CalEvent = {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  kind: "meeting" | "work";
  request_id: number | null;
};
export type FyiMessage = {
  id: number;
  channel: "outlook" | "teams";
  sender_name: string;
  subject: string | null;
  snippet: string;
  received_at: string;
  category: "no_action" | "suspicious";
  reason: string;
};
export type Home = {
  now: string;
  last_checked: string;
  summary: { new_messages: number; new_requests: number; answers: number; changes: number; no_action: number; suspicious: number };
  sections: Section[];
  free_slots: { start: string; end: string; minutes: number }[];
  events: CalEvent[];
  fyi: FyiMessage[];
};
export type Message = {
  id: number;
  channel: "outlook" | "teams";
  direction: "received" | "sent";
  sender_name: string;
  sender_email: string;
  subject: string | null;
  body: string;
  received_at: string;
  role?: string;
  linked_by?: string;
};
export type Field = {
  id: number;
  name: string;
  value: string | null;
  state: "filled" | "missing" | "deferred";
  confidence: "confirmed" | "inferred" | null;
  evidence_message_id: number | null;
  evidence_text: string | null;
  missing_initially: number;
};
export type History = {
  id: number;
  at: string;
  actor: "ai" | "user" | "system";
  kind: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  message_id: number | null;
  note: string | null;
};
export type Candidate = {
  id: number;
  status: "pending" | "accepted" | "rejected";
  reasons: string[];
  message: Message;
  proposed_values: Record<string, string>; // 同じ依頼とつないだ場合に変わる値
  highlights: string[]; // 理由に対応する原文の箇所
};
export type RequestDetail = {
  id: number;
  title: string;
  type_code: string;
  type_name: string;
  requester_name: string;
  requester_email: string;
  status: string;
  status_label: string;
  requested_due: string | null;
  committed_due: string | null;
  due_change_status: string | null;
  effort_minutes: number | null;
  missing_fields: string[];
  pending_candidates: number;
  fields: Field[];
  messages: Message[];
  candidates: Candidate[];
  history: History[];
  work_slots: CalEvent[];
  drafts: Draft[];
  document: DocumentDraft | null;
  files: { name: string; allowed: boolean }[];
  slot_plan: SlotPlan;
};
export type SlotPlan = {
  needs_effort: boolean;
  effort?: number;
  deadline?: string | null;
  deadline_label?: string | null;
  candidates: { start: string; end: string; minutes: number; before_deadline: boolean }[];
  enough: boolean | null;
  free_before_deadline: number | null;
  earliest_finish?: string | null;
  options: { kind: "quick" | "consult"; label: string; description: string }[];
};
export type Slide = {
  title: string;
  bullets?: string[];
  table?: { header: string[]; rows: string[][] };
  chart?: { categories: string[]; series: { name: string; values: number[] }[] } | null;
};
export type DocumentDraft = {
  id: number;
  request_id: number;
  title: string;
  version: number;
  needs_review: boolean;
  changes: { label: string; old: string; new: string }[];
  generator: string;
  content: {
    title: string;
    label: string;
    complete: boolean;
    unconfirmed: string[];
    footer: string;
    source: { file: string; sheet: string; period: string; period_evidence: string | null; row_count: number; aggregated_at: string } | null;
    slides: Slide[];
  };
};
export type Draft = {
  id: number;
  request_id: number;
  kind: "due_adjust" | "confirm" | "answer" | "completion" | "schedule_consult";
  kind_label: string;
  channel: "outlook" | "teams";
  to_name: string;
  to_email: string;
  subject: string | null;
  body: string;
  generated_body: string;
  is_edited: number;
  has_new_suggestion: number;
  status: "draft" | "saved" | "sent" | "discarded";
  needs_review: boolean;
  changes: { label: string; old: string; new: string }[];
  has_placeholder: boolean;
  generator: string;
  updated_at: string;
};

export type Health = { status: string; mode: string; m365: { implemented: boolean; connectable: boolean } };

// ---- 画面の利用記録（朝の段取り時間の計測）。開いた時刻と、最初の操作の時刻だけを送る
function newSessionId(): string {
  try {
    const saved = window.sessionStorage.getItem("workrelay.session");
    if (saved) return saved;
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.sessionStorage.setItem("workrelay.session", id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}
const usage = { session: newSessionId(), opened: false, acted: false };

// ---- データ領域：デモツアー中は「tour」（ツアー専用のDB）を使い、利用者のデモのデータを変えない
let space: "demo" | "tour" = "demo";
export const dataSpace = {
  get: () => space,
  set: (s: "demo" | "tour") => { space = s; },
};
const NOT_ACTIONS = ["/api/usage", "/api/demo/reset", "/api/ingest"];

export const tracking = {
  /** 「今日やること」を開いた（朝の確認を開始） */
  homeOpened() {
    if (usage.opened || space === "tour") return; // ツアー中の操作は計測に含めない
    usage.opened = true;
    fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: usage.session, kind: "home_open" }) }).catch(() => {});
  },
  /** 最初の行動を決めた（返信案を開く・判断・並べ替えなど） */
  firstAction(requestId?: number) {
    if (!usage.opened || usage.acted || space === "tour") return;
    usage.acted = true;
    fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: usage.session, kind: "first_action", request_id: requestId ?? null }) }).catch(() => {});
  },
  /** デモをやり直したら、計測も最初から */
  restart() {
    usage.session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    usage.opened = false;
    usage.acted = false;
  },
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== "GET" && !NOT_ACTIONS.some((p) => path.startsWith(p))) tracking.firstAction();
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (space === "tour") headers["X-WorkRelay-Space"] = "tour";
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* 本文が JSON でない場合はそのまま */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  health: () => call<Health>("GET", "/api/health"),
  home: () => call<Home>("GET", "/api/home"),
  ingest: () => call<{ new_messages: number }>("POST", "/api/ingest"),
  resetDemo: () => call("POST", "/api/demo/reset"),
  request: (id: number) => call<RequestDetail>("GET", `/api/requests/${id}`),
  requests: () => call<RequestDetail[]>("GET", "/api/requests"),
  acceptCandidate: (id: number) => call<RequestDetail>("POST", `/api/candidates/${id}/accept`),
  rejectCandidate: (id: number) => call<RequestDetail>("POST", `/api/candidates/${id}/reject`),
  decideDue: (id: number, decision: "accept" | "keep") =>
    call<RequestDetail>("POST", `/api/requests/${id}/due-decision`, { decision }),
  updateRequest: (id: number, changes: { effort_minutes?: number; status?: string; fields?: Record<string, string> }) =>
    call<RequestDetail>("PATCH", `/api/requests/${id}`, changes),
  setOrder: (ids: number[]) => call("PUT", "/api/home/order", { request_ids: ids }),
  snooze: (id: number, snoozed: boolean) => call("PUT", `/api/requests/${id}/snooze`, { snoozed }),
  events: () => call<CalEvent[]>("GET", "/api/events"),
  createDraft: (requestId: number, kind: Draft["kind"]) => call<Draft>("POST", `/api/requests/${requestId}/drafts`, { kind }),
  editDraft: (id: number, body: string) => call<Draft>("PATCH", `/api/drafts/${id}`, { body }),
  draftAction: (id: number, action: "copy" | "save" | "sent" | "discard" | "apply-suggestion") =>
    call<Draft>("POST", `/api/drafts/${id}/${action}`),
  setFilePermission: (requestId: number, fileName: string, allowed: boolean) =>
    call("PUT", `/api/requests/${requestId}/files`, { file_name: fileName, allowed }),
  createDocument: (requestId: number) => call<DocumentDraft>("POST", `/api/requests/${requestId}/document`),
  documentUrl: (id: number) => `/api/documents/${id}/download${space === "tour" ? "?space=tour" : ""}`,
  createSlot: (requestId: number, start: string, end: string) =>
    call<CalEvent>("POST", `/api/requests/${requestId}/work-slots`, { start, end }),
  deleteSlot: (eventId: number) => call("DELETE", `/api/work-slots/${eventId}`),
  report: () => call<Report>("GET", "/api/report"),
};

export type Report = {
  labels: { sample: string; measured: string; real: string };
  morning: {
    measured: { count: number; latest_seconds: number; median_seconds: number; condition: string } | null;
    sample: {
      before: { label: string; period: string; days: number; median_minutes: number };
      after: { label: string; period: string; days: number; median_minutes: number };
      condition: string;
    };
    real: null;
  };
  flow: {
    rows: { id: number; title: string; type: string; round_trips: number; hours_to_ready: number | null; complete_first: boolean }[];
    by_type: { type: string; count: number; complete_first_rate: number; avg_round_trips: number; avg_hours_to_ready: number | null; ready_count: number }[];
    period: string | null;
    condition: string;
  };
  drafts: { drafts: { as_is: number; edited: number; unused: number; pending: number }; total: number; document_downloads: number; condition: string };
  missing: { type: string; count: number; fields: { field: string; count: number }[]; hint: string | null }[];
  template_change: {
    type: string; change: string; condition: string;
    before: { period: string; count: number; complete_first_rate: number; avg_round_trips: number; avg_hours_to_ready: number };
    after: { period: string; count: number; complete_first_rate: number; avg_round_trips: number; avg_hours_to_ready: number };
  };
};

// ---- 表示用の小道具

const WD = "日月火水木金土";
export function fmtDue(iso: string | null, nowIso?: string): string {
  if (!iso) return "未設定";
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (nowIso && new Date(nowIso).toDateString() === d.toDateString()) return `今日 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）${hm}`;
}
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export const CHANNEL: Record<string, string> = { outlook: "Outlook", teams: "Teams" };

/** 状態ラベルの色：着手可能＝ミント、情報不足＝アンバー、作業中＝シアン、それ以外は無彩色 */
export function statusClass(status: string): string {
  return { ready: "ok", done: "ok", needs_info: "warn", in_progress: "cyan" }[status] ?? "";
}

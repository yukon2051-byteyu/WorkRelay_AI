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
};
export type Draft = {
  id: number;
  request_id: number;
  kind: "due_adjust" | "confirm" | "answer" | "completion";
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

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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

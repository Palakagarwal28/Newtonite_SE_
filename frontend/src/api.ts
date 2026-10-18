/**
 * Typed client for the Newtonite backend. Every path, method, body, and query
 * key below mirrors the real API contracts in backend/src/routes/*.ts —
 * verified by backend integration tests (backend/tests/*.test.ts).
 * Component tests mock `fetch`; backend correctness is covered server-side.
 */

export type Role = "ADMIN" | "MANAGER" | "MEMBER";
export type WorkStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "IN_REVIEW"
  | "DONE"
  | "CLOSED";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface User {
  id: string;
  email: string;
  name: string;
  isGlobalAdmin: boolean;
}

export interface Membership {
  teamId: string;
  teamName: string;
  role: Role;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  /** Null = visible via global-admin grant, not membership. */
  role: Role | null;
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  status: WorkStatus;
  priority: Priority;
  version: number;
  teamId: string;
  team?: { id: string; name: string };
  assigneeId: string | null;
  assignee: { id: string; email: string; name: string } | null;
  createdById: string | null;
  createdBy: { id: string; email: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemDetail extends WorkItem {
  recentComments: Comment[];
  commentCount: number;
  activityCount: number;
}

export interface Comment {
  id: string;
  body: string;
  authorId: string;
  author: { id: string; email: string; name: string };
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  action: string;
  actorId: string | null;
  actor: { id: string; email: string; name: string } | null;
  detail: unknown;
  version: number;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ActivityPage {
  events: ActivityEvent[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListFilters {
  teamId?: string;
  status?: WorkStatus | "";
  priority?: Priority | "";
  assigneeId?: string;
  mine?: boolean;
  q?: string;
  page: number;
  pageSize: number;
}

/** Backend error envelope: { error: { code, message, details? } }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Friendly one-liners per backend error code for display (never a security control). */
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INVALID_CREDENTIALS":
        return "Invalid email or password.";
      case "UNAUTHENTICATED":
      case "INVALID_TOKEN":
        return "Your session expired. Please log in again.";
      case "TEAM_ACCESS_DENIED":
        return "You are not a member of this team.";
      case "ROLE_REQUIRED":
        return "Your role does not allow this action (server refused).";
      case "VERSION_CONFLICT":
        return "This work item changed elsewhere. Review the latest version — your edits are preserved below.";
      case "INVALID_STATUS_TRANSITION":
        return `Illegal status transition. ${allowedHint(err.details)}`;
      case "ASSIGNEE_NOT_TEAM_MEMBER":
        return "Assignee must be a member of this team.";
      case "VALIDATION_ERROR":
        return `Invalid input. ${validationHint(err.details)}`;
      case "WORK_ITEM_NOT_FOUND":
        return "Work item not found.";
      case "TEAM_NOT_FOUND":
        return "Team not found.";
      default:
        return err.message || `Request failed (${err.status}).`;
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

function allowedHint(details: unknown): string {
  if (
    typeof details === "object" &&
    details !== null &&
    Array.isArray((details as Record<string, unknown>).allowed)
  ) {
    const allowed = (details as Record<string, unknown[]>).allowed.join(", ");
    return allowed ? `Allowed: ${allowed}.` : "";
  }
  return "";
}

function validationHint(details: unknown): string {
  if (typeof details === "object" && details !== null) {
    const fields = Object.keys(details as Record<string, unknown>);
    return fields.length > 0 ? `Check: ${fields.join(", ")}.` : "";
  }
  return "";
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Backend unreachable. Is it running?");
  }
  if (res.ok) return (await res.json()) as T;
  let code = `HTTP_${res.status}`;
  let message = `Request failed (${res.status}).`;
  let details: unknown;
  try {
    const data = (await res.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details;
    }
  } catch {
    // Non-JSON error body — keep the HTTP fallback.
  }
  throw new ApiError(res.status, code, message, details);
}

// --- Auth -------------------------------------------------------------------

export interface LoginResponse {
  token: string;
  expiresIn: string;
  user: User;
}

export interface MeResponse {
  user: User;
  memberships: Membership[];
}

export function apiLogin(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function apiMe(token: string): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/me", { token });
}

// --- Teams ------------------------------------------------------------------

export function apiListTeams(token: string): Promise<{ teams: Team[] }> {
  return request<{ teams: Team[] }>("/api/teams", { token });
}

export function apiListMembers(token: string, teamId: string): Promise<{ members: TeamMember[] }> {
  return request<{ members: TeamMember[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/members`,
    { token },
  );
}

// --- Work items ---------------------------------------------------------------

export interface CreateWorkItemBody {
  teamId: string;
  title: string;
  description: string;
  priority?: Priority;
  assigneeId?: string | null;
}

export function apiCreateWorkItem(token: string, body: CreateWorkItemBody) {
  return request<{ item: WorkItem }>("/api/work-items", {
    method: "POST",
    body,
    token,
  });
}

export function apiListWorkItems(token: string, f: ListFilters): Promise<Page<WorkItem>> {
  const query = buildQuery({
    teamId: f.teamId,
    status: f.status || undefined,
    priority: f.priority || undefined,
    assigneeId: f.assigneeId,
    mine: f.mine ? true : undefined,
    q: f.q?.trim() ? f.q.trim() : undefined,
    page: f.page,
    pageSize: f.pageSize,
  });
  return request<Page<WorkItem>>(`/api/work-items${query}`, { token });
}

export function apiGetWorkItem(token: string, id: string): Promise<WorkItemDetail> {
  return request<WorkItemDetail>(`/api/work-items/${encodeURIComponent(id)}`, { token });
}

export interface UpdateWorkItemBody {
  expectedVersion: number;
  title?: string;
  description?: string;
  priority?: Priority;
  status?: WorkStatus;
  /** string = assign, null = unassign, absent = unchanged */
  assigneeId?: string | null;
}

export function apiUpdateWorkItem(token: string, id: string, body: UpdateWorkItemBody) {
  return request<{ item: WorkItem }>(`/api/work-items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    token,
  });
}

export function apiAddComment(token: string, id: string, body: string) {
  return request<{ comment: Comment }>(`/api/work-items/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    body: { body },
    token,
  });
}

export function apiListActivity(
  token: string,
  id: string,
  page: number,
  pageSize: number,
): Promise<ActivityPage> {
  const query = buildQuery({ page, pageSize });
  return request<ActivityPage>(`/api/work-items/${encodeURIComponent(id)}/activity${query}`, {
    token,
  });
}

export function apiHealth(): Promise<{ status: string; service: string; time: string }> {
  return request("/api/health");
}

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  apiAddComment,
  apiGetWorkItem,
  apiListActivity,
  apiListMembers,
  apiUpdateWorkItem,
  friendlyMessage,
  type ActivityEvent,
  type Priority,
  type TeamMember,
  type UpdateWorkItemBody,
  type WorkItemDetail,
  type WorkStatus,
} from "../api.ts";
import { useAuth } from "../auth.tsx";
import { allowedTransitions, canTransitionOrAssign } from "../rules.ts";
import { PriorityBadge, StatusBadge, VersionBadge } from "../components/Badges.tsx";
import {
  ActivityIcon,
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  UserIcon,
} from "../components/Icons.tsx";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

interface Conflict {
  /** The exact payload the server rejected — kept so nothing is lost. */
  attempted: UpdateWorkItemBody;
  serverVersion: number;
}

export default function DetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { token, me, logout } = useAuth();
  const [item, setItem] = useState<WorkItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [status, setStatus] = useState<WorkStatus>("OPEN");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const [commentBody, setCommentBody] = useState("");
  const [commentPending, setCommentPending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPending, setActivityPending] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await apiGetWorkItem(token, id);
      setItem(detail);
      setTitle(detail.title);
      setDescription(detail.description);
      setPriority(detail.priority);
      setStatus(detail.status);
      setAssigneeId(detail.assigneeId);
      const act = await apiListActivity(token, id, 1, 10);
      setEvents(act.events);
      setActivityPage(1);
      setActivityTotal(act.total);
      const mem = await apiListMembers(token, detail.teamId).catch(() => ({
        members: [] as TeamMember[],
      }));
      setMembers(mem.members);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout();
      setError(friendlyMessage(e));
    } finally {
      setLoading(false);
    }
  }, [token, id, logout]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberships = me?.memberships ?? [];
  const canManage =
    !!me && !!item && canTransitionOrAssign(me.user.isGlobalAdmin, memberships, item.teamId);
  const legalStatuses = item
    ? [item.status, ...allowedTransitions(item.status).filter((s) => s !== item.status)]
    : [];

  async function save() {
    if (!token || !item || saving) return;
    setSaveError(null);
    setSavedNote(null);
    const body: UpdateWorkItemBody = { expectedVersion: item.version };
    if (title.trim() !== item.title) body.title = title.trim();
    if (description.trim() !== item.description) body.description = description.trim();
    if (priority !== item.priority) body.priority = priority;
    if (canManage && status !== item.status) body.status = status;
    if (canManage && assigneeId !== item.assigneeId) body.assigneeId = assigneeId;
    if (Object.keys(body).length === 1) {
      setSaveError("No changes to save.");
      return;
    }
    if (!title.trim() || !description.trim()) {
      setSaveError("Title and description cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiUpdateWorkItem(token, item.id, body);
      const fresh = await apiGetWorkItem(token, item.id);
      setItem(fresh);
      setTitle(fresh.title);
      setDescription(fresh.description);
      setPriority(fresh.priority);
      setStatus(fresh.status);
      setAssigneeId(fresh.assigneeId);
      setConflict(null);
      setSavedNote(`Saved as version ${res.item.version}.`);
      const act = await apiListActivity(token, item.id, 1, 10);
      setEvents(act.events);
      setActivityPage(1);
      setActivityTotal(act.total);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        return;
      }
      if (e instanceof ApiError && e.status === 409) {
        // Preserve the rejected payload; never retry automatically.
        setConflict({ attempted: body, serverVersion: -1 });
        setSaveError(friendlyMessage(e));
        // Refresh the server state so the user can compare (draft untouched).
        try {
          const fresh = await apiGetWorkItem(token, item.id);
          setItem(fresh);
          setConflict({ attempted: body, serverVersion: fresh.version });
        } catch {
          // Keep the conflict panel even if the refresh fails.
        }
        return;
      }
      setSaveError(friendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function addComment() {
    if (!token || !item || commentPending) return;
    if (!commentBody.trim()) {
      setCommentError("Comment cannot be empty.");
      return;
    }
    setCommentPending(true);
    setCommentError(null);
    try {
      await apiAddComment(token, item.id, commentBody.trim());
      setCommentBody("");
      const fresh = await apiGetWorkItem(token, item.id);
      setItem(fresh);
      const act = await apiListActivity(token, item.id, 1, 10);
      setEvents(act.events);
      setActivityPage(1);
      setActivityTotal(act.total);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout();
      setCommentError(friendlyMessage(e));
    } finally {
      setCommentPending(false);
    }
  }

  async function loadMoreActivity() {
    if (!token || !item || activityPending) return;
    setActivityPending(true);
    try {
      const next = await apiListActivity(token, item.id, activityPage + 1, 10);
      setEvents((prev) => [...prev, ...next.events]);
      setActivityPage(next.page);
      setActivityTotal(next.total);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout();
    } finally {
      setActivityPending(false);
    }
  }

  if (loading) {
    return (
      <div className="panel" style={{ textAlign: "center", padding: "3rem 1rem" }}>
        <RefreshCwIcon
          style={{
            animation: "spin 1s linear infinite",
            color: "var(--primary)",
            marginBottom: "0.5rem",
          }}
        />
        <p aria-label="Loading work item" style={{ margin: 0, color: "var(--text-muted)" }}>
          Loading work item…
        </p>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="panel error" role="alert" style={{ maxWidth: 500, margin: "2rem auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <AlertCircleIcon style={{ color: "#e11d48" }} />
          <p className="error" style={{ margin: 0, fontWeight: 600 }}>
            {error ?? "Not found."}
          </p>
        </div>
        <div className="row">
          <button type="button" onClick={onBack}>
            <ArrowLeftIcon /> Back
          </button>
          <button type="button" onClick={() => void load()}>
            <RefreshCwIcon /> Retry
          </button>
        </div>
      </div>
    );
  }

  const shortKey = `WI-${item.id.slice(-6).toUpperCase()}`;

  return (
    <div className="detail-view">
      {/* Top back navigation */}
      <div style={{ marginBottom: "1rem" }}>
        <button type="button" onClick={onBack} className="btn-subtle" title="Return to work items list">
          <ArrowLeftIcon /> Back to list
        </button>
      </div>

      <div className="detail-layout">
        {/* Left / Main Column */}
        <div className="detail-main">
          {/* Work Item Header Card */}
          <div className="detail-header-card">
            <div className="detail-key-row">
              <span className="mono badge-version" style={{ fontSize: "0.85rem", fontWeight: 700 }}>
                {shortKey}
              </span>
              <StatusBadge status={item.status} />
              <PriorityBadge priority={item.priority} />
              <VersionBadge version={item.version} />
            </div>

            <h2 className="detail-title">
              <span className="mono small muted">{shortKey}</span> · {item.title}
            </h2>

            <div className="detail-meta-text muted small">
              <span>{item.team?.name}</span>
              <span>·</span>
              <span>version {item.version}</span>
              <span>·</span>
              <span>updated {new Date(item.updatedAt).toLocaleString()}</span>
              <span>·</span>
              <span>created by {item.createdBy?.name ?? "—"}</span>
            </div>
          </div>

          {/* 409 Conflict Alert Panel */}
          {conflict && (
            <div role="alert" className="panel conflict">
              <h3>
                <AlertCircleIcon /> Conflict: changed elsewhere (409)
              </h3>
              <p>
                Someone saved version {conflict.serverVersion} while you were editing version{" "}
                {conflict.attempted.expectedVersion}. Your attempted changes are preserved in the
                form below — nothing was overwritten and no automatic retry happened.
              </p>
              <AttemptedChanges attempted={conflict.attempted} />
              <div className="row" style={{ marginTop: "1rem" }}>
                <button type="button" className="btn-primary" onClick={() => void load()}>
                  <RefreshCwIcon /> Reload latest (keeps my draft)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTitle(item.title);
                    setDescription(item.description);
                    setPriority(item.priority);
                    setStatus(item.status);
                    setAssigneeId(item.assigneeId);
                    setConflict(null);
                    setSaveError(null);
                  }}
                >
                  Discard my changes
                </button>
              </div>
            </div>
          )}

          {/* Edit Form Card */}
          <section aria-label="Edit work item" className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h3 style={{ margin: 0 }}>Work Item Details</h3>
              <span className="muted small">Optimistic concurrency protected (v{item.version})</span>
            </div>

            <label>
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                disabled={saving}
              />
            </label>

            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                disabled={saving}
              />
            </label>

            <div className="row" style={{ marginTop: "0.75rem", marginBottom: "0.75rem" }}>
              <label style={{ flex: 1 }}>
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  disabled={saving}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>

              {canManage ? (
                <>
                  <label style={{ flex: 1 }}>
                    Status (legal transitions from {item.status}; DONE ≠ CLOSED)
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as WorkStatus)}
                      disabled={saving}
                    >
                      {legalStatuses.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ flex: 1 }}>
                    Assignee
                    <select
                      value={assigneeId ?? ""}
                      onChange={(e) => setAssigneeId(e.target.value || null)}
                      disabled={saving}
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name} ({m.role})
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <div style={{ flex: 2, padding: "0.5rem 0" }}>
                  <p className="muted small" style={{ margin: 0 }}>
                    Status: <b>{item.status}</b> · Assignee: <b>{item.assignee?.name ?? "Unassigned"}</b>{" "}
                    — changing these requires MANAGER or ADMIN (enforced by the server).
                  </p>
                </div>
              )}
            </div>

            {saveError && !conflict && (
              <p className="error" role="alert" style={{ marginTop: "0.5rem" }}>
                {saveError}
              </p>
            )}
            {conflict && saveError && (
              <p className="error" role="alert" style={{ marginTop: "0.5rem" }}>
                {saveError}
              </p>
            )}
            {savedNote && (
              <p className="ok" role="status" style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <CheckCircleIcon /> {savedNote}
              </p>
            )}

            <div style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? "Saving…" : `Save (version ${item.version})`}
              </button>
            </div>
          </section>

          {/* Comments Section */}
          <section aria-label="Comments" className="panel">
            <h3>
              <MessageSquareIcon /> Comments ({item.commentCount})
            </h3>

            {item.recentComments.length === 0 ? (
              <p className="muted" style={{ fontStyle: "italic", margin: "1rem 0" }}>
                No comments yet.
              </p>
            ) : (
              <ul className="comments">
                {item.recentComments.map((c) => (
                  <li key={c.id}>
                    <div className="comment-header">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: "var(--primary-subtle)",
                            color: "var(--primary)",
                            fontSize: "0.65rem",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {c.author.name ? c.author.name[0].toUpperCase() : "U"}
                        </div>
                        <span className="comment-author">{c.author.name}</span>
                      </div>
                      <span className="comment-time">
                        <ClockIcon style={{ verticalAlign: -2, marginRight: 2 }} />
                        {new Date(c.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="comment-body">{c.body}</div>
                  </li>
                ))}
              </ul>
            )}

            <label>
              Add a comment
              <textarea
                value={commentBody}
                placeholder="Write your note or update here…"
                onChange={(e) => setCommentBody(e.target.value)}
                rows={3}
                maxLength={5000}
                disabled={commentPending}
              />
            </label>

            {commentError && (
              <p className="error" role="alert" style={{ marginTop: "0.5rem" }}>
                {commentError}
              </p>
            )}

            <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="muted small">
                Comments do not increment the work-item version.
              </span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void addComment()}
                disabled={commentPending}
              >
                {commentPending ? "Posting…" : "Post comment"}
              </button>
            </div>
          </section>
        </div>

        {/* Right / Sidebar Column */}
        <div className="detail-sidebar">
          {/* Metadata Card */}
          <div className="panel">
            <h3 style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              Properties
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Status</span>
                <StatusBadge status={item.status} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Priority</span>
                <PriorityBadge priority={item.priority} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Assignee</span>
                <span>
                  {item.assignee ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                      <UserIcon style={{ width: 13, height: 13, color: "var(--text-muted)" }} />
                      {item.assignee.name}
                    </span>
                  ) : (
                    <span className="muted">Unassigned</span>
                  )}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Team</span>
                <span style={{ fontWeight: 500 }}>{item.team?.name ?? "—"}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Version</span>
                <VersionBadge version={item.version} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Created</span>
                <span className="small muted">
                  {new Date(item.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Updated</span>
                <span className="small muted">
                  {new Date(item.updatedAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Activity Timeline Card */}
          <section aria-label="Activity timeline" className="panel">
            <h3>
              <ActivityIcon /> Activity ({activityTotal})
            </h3>

            {events.length === 0 ? (
              <p className="muted" style={{ fontStyle: "italic" }}>
                No activity yet.
              </p>
            ) : (
              <ul className="activity">
                {events.map((e) => (
                  <li key={e.id}>
                    <div className="activity-node" />
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.35rem", flexWrap: "wrap" }}>
                      <span className="mono small muted">v{e.version}</span>
                      <b className="activity-action">{e.action}</b>
                      <span className="activity-actor">by {e.actor?.name ?? "—"}</span>
                      <span className="muted small">· {new Date(e.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <EventDetail detail={e.detail} />
                  </li>
                ))}
              </ul>
            )}

            {events.length < activityTotal && (
              <button
                type="button"
                className="btn-subtle"
                style={{ width: "100%", marginTop: "0.5rem" }}
                onClick={() => void loadMoreActivity()}
                disabled={activityPending}
              >
                {activityPending ? "Loading…" : `Load more (${activityTotal - events.length} remaining)`}
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function AttemptedChanges({ attempted }: { attempted: UpdateWorkItemBody }) {
  const entries = Object.entries(attempted).filter(([k]) => k !== "expectedVersion");
  if (entries.length === 0) return null;
  return (
    <ul className="small" style={{ margin: "0.5rem 0", paddingLeft: "1.25rem" }}>
      {entries.map(([k, v]) => (
        <li key={k} style={{ margin: "0.2rem 0" }}>
          <code>{k}</code>: <code>{JSON.stringify(v)}</code>
        </li>
      ))}
    </ul>
  );
}

function EventDetail({ detail }: { detail: unknown }) {
  if (detail === null || detail === undefined) return null;
  if (typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(d)) {
      if (k === "commentId" || k === "excerpt") continue;
      if (
        typeof v === "object" &&
        v !== null &&
        "before" in (v as object) &&
        "after" in (v as object)
      ) {
        const pair = v as { before: unknown; after: unknown };
        parts.push(`${k}: ${JSON.stringify(pair.before)} → ${JSON.stringify(pair.after)}`);
      } else if (k === "descriptionChanged") {
        parts.push("description edited");
      } else {
        parts.push(`${k}: ${JSON.stringify(v)}`);
      }
    }
    if ("excerpt" in d && typeof d.excerpt === "string") parts.push(`“${d.excerpt}”`);
    if (parts.length === 0) return null;
    return <div className="activity-detail">{parts.join(" · ")}</div>;
  }
  return <div className="activity-detail">{String(detail)}</div>;
}

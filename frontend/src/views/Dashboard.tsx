import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  apiCreateWorkItem,
  apiListMembers,
  apiListTeams,
  apiListWorkItems,
  friendlyMessage,
  type ListFilters,
  type Priority,
  type Team,
  type TeamMember,
  type WorkItem,
  type WorkStatus,
} from "../api.ts";
import { useAuth } from "../auth.tsx";
import { PriorityBadge, StatusBadge } from "../components/Badges.tsx";
import {
  AlertCircleIcon,
  FilterIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  UserIcon,
  XIcon,
} from "../components/Icons.tsx";

const STATUSES: WorkStatus[] = ["OPEN", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CLOSED"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const PAGE_SIZE = 20;

interface Metrics {
  total: number;
  mine: number;
  urgent: number;
  byStatus: Record<WorkStatus, number>;
}

const EMPTY_METRICS: Metrics = {
  total: 0,
  mine: 0,
  urgent: 0,
  byStatus: { OPEN: 0, IN_PROGRESS: 0, BLOCKED: 0, IN_REVIEW: 0, DONE: 0, CLOSED: 0 },
};

function shortId(id: string): string {
  return id.slice(-6).toUpperCase();
}

export interface DashboardViewProps {
  onOpen: (id: string) => void;
  teamId?: string;
  onTeamChange?: (teamId: string) => void;
  mineFilter?: boolean;
  onMineChange?: (mine: boolean) => void;
  urgentFilter?: boolean;
  onUrgentChange?: (urgent: boolean) => void;
  createOpen?: boolean;
  onCloseCreate?: () => void;
}

export default function DashboardView({
  onOpen,
  teamId: propTeamId,
  onTeamChange,
  mineFilter: propMine,
  onMineChange,
  urgentFilter: propUrgent,
  onUrgentChange,
  createOpen: propCreateOpen,
  onCloseCreate,
}: DashboardViewProps) {
  const { token, me, logout } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Filters state (sync with props if provided, otherwise internal)
  const [internalTeamId, setInternalTeamId] = useState("");
  const teamId = propTeamId !== undefined ? propTeamId : internalTeamId;
  const setTeamId = (t: string) => {
    setInternalTeamId(t);
    onTeamChange?.(t);
  };

  const [status, setStatus] = useState<WorkStatus | "">("");

  const [internalPriority, setInternalPriority] = useState<Priority | "">("");
  const priority = propUrgent ? "URGENT" : propUrgent === false && internalPriority === "URGENT" ? "" : internalPriority;
  const setPriority = (p: Priority | "") => {
    setInternalPriority(p);
    if (p === "URGENT") {
      onUrgentChange?.(true);
    } else {
      onUrgentChange?.(false);
    }
  };

  const [assigneeId, setAssigneeId] = useState("");

  const [internalMine, setInternalMine] = useState(false);
  const mine = propMine !== undefined ? propMine : internalMine;
  const setMine = (m: boolean) => {
    setInternalMine(m);
    onMineChange?.(m);
  };

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);

  const requestSeq = useRef(0);

  // Debounce free-text search so every keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters = useMemo<ListFilters>(
    () => ({
      teamId: teamId || undefined,
      status: status || undefined,
      priority: priority || undefined,
      assigneeId: assigneeId || undefined,
      mine: mine || undefined,
      q: debouncedQ || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [teamId, status, priority, assigneeId, mine, debouncedQ, page],
  );

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) logout();
    },
    [logout],
  );

  // Teams for the filter dropdown
  useEffect(() => {
    if (!token) return;
    apiListTeams(token)
      .then((r) => setTeams(r.teams))
      .catch(handleAuthError);
  }, [token, handleAuthError]);

  // Members of the selected team feed the assignee filter + create dialog.
  useEffect(() => {
    if (!token || !teamId) {
      setMembers([]);
      return;
    }
    apiListMembers(token, teamId)
      .then((r) => setMembers(r.members))
      .catch((e) => {
        handleAuthError(e);
        setMembers([]);
      });
  }, [token, teamId, handleAuthError]);

  const load = useCallback(async () => {
    if (!token) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const [list, ...counts] = await Promise.all([
        apiListWorkItems(token, filters),
        ...STATUSES.map((s) =>
          apiListWorkItems(token, {
            teamId: filters.teamId,
            q: filters.q,
            status: s,
            page: 1,
            pageSize: 1,
          }),
        ),
        apiListWorkItems(token, {
          teamId: filters.teamId,
          q: filters.q,
          mine: true,
          page: 1,
          pageSize: 1,
        }),
        apiListWorkItems(token, {
          teamId: filters.teamId,
          q: filters.q,
          priority: "URGENT",
          page: 1,
          pageSize: 1,
        }),
      ]);
      if (seq !== requestSeq.current) return; // superseded by a newer filter change
      setItems(list.items);
      setTotal(list.total);
      setTotalPages(list.totalPages);
      const byStatus = Object.fromEntries(
        STATUSES.map((s, i) => [s, counts[i].total]),
      ) as Record<WorkStatus, number>;
      setMetrics({
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        mine: counts[STATUSES.length].total,
        urgent: counts[STATUSES.length + 1].total,
        byStatus,
      });
    } catch (e) {
      if (seq !== requestSeq.current) return;
      handleAuthError(e);
      setError(friendlyMessage(e));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [token, filters, handleAuthError]);

  useEffect(() => {
    void load();
  }, [load]);

  const myTeamIds = useMemo(() => new Set((me?.memberships ?? []).map((m) => m.teamId)), [me]);

  const isAnyFilterActive = Boolean(
    teamId || status || priority || assigneeId || mine || q.trim(),
  );

  function resetAllFilters() {
    setTeamId("");
    setStatus("");
    setPriority("");
    setAssigneeId("");
    setMine(false);
    setQ("");
    setDebouncedQ("");
    setPage(1);
  }

  const isModalOpen = showCreate || Boolean(propCreateOpen);
  const closeModal = () => {
    setShowCreate(false);
    onCloseCreate?.();
  };

  return (
    <div className="dashboard-view">
      {/* Metrics Section */}
      <section aria-label="Summary metrics" className="metrics-container">
        <div className="metrics-header">
          <h3>Operations Overview</h3>
          <span className="muted small">
            {metrics.total} total item{metrics.total === 1 ? "" : "s"} across active scope
          </span>
        </div>

        {/* Visual lifecycle summary bar */}
        {metrics.total > 0 && (
          <div
            className="status-summary-bar"
            title={`Status distribution: ${STATUSES.map(
              (s) => `${s}: ${metrics.byStatus[s]}`,
            ).join(", ")}`}
          >
            {STATUSES.map((s) => {
              const count = metrics.byStatus[s];
              if (count === 0) return null;
              const pct = (count / metrics.total) * 100;
              const colors: Record<WorkStatus, string> = {
                OPEN: "#6366f1",
                IN_PROGRESS: "#0284c7",
                BLOCKED: "#e11d48",
                IN_REVIEW: "#d97706",
                DONE: "#10b981",
                CLOSED: "#94a3b8",
              };
              return (
                <div
                  key={s}
                  className="status-bar-segment"
                  style={{ width: `${pct}%`, backgroundColor: colors[s] }}
                />
              );
            })}
          </div>
        )}

        <div className="metrics">
          <Metric
            label="Total"
            value={metrics.total}
            interactive
            active={!status && !priority && !mine}
            onClick={() => {
              setStatus("");
              setPriority("");
              setMine(false);
              setPage(1);
            }}
          />
          <Metric
            label="Assigned to me"
            value={metrics.mine}
            interactive
            active={mine}
            onClick={() => {
              setMine(!mine);
              setAssigneeId("");
              setPage(1);
            }}
          />
          <Metric
            label="Urgent"
            value={metrics.urgent}
            interactive
            active={priority === "URGENT"}
            onClick={() => {
              setPriority(priority === "URGENT" ? "" : "URGENT");
              setPage(1);
            }}
          />
          {STATUSES.map((s) => (
            <Metric
              key={s}
              label={s}
              value={metrics.byStatus[s]}
              small
              interactive
              active={status === s}
              onClick={() => {
                setStatus(status === s ? "" : s);
                setPage(1);
              }}
            />
          ))}
        </div>
      </section>

      {/* Filter Toolbar */}
      <section aria-label="Filters" className="toolbar-card">
        <div className="filters">
          <label>
            Team
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setAssigneeId("");
                setPage(1);
              }}
            >
              <option value="">All my teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as WorkStatus | "");
                setPage(1);
              }}
            >
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            Priority
            <select
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as Priority | "");
                setPage(1);
              }}
            >
              <option value="">Any</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label>
            Assignee
            <select
              value={assigneeId}
              disabled={!teamId}
              title={teamId ? "Members of the selected team" : "Select a team first"}
              onChange={(e) => {
                setAssigneeId(e.target.value);
                setMine(false);
                setPage(1);
              }}
            >
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.role})
                </option>
              ))}
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => {
                setMine(e.target.checked);
                setAssigneeId("");
                setPage(1);
              }}
            />
            Mine only
          </label>

          <label className="grow">
            Search
            <div className="search-input-wrapper">
              <SearchIcon className="search-icon" />
              <input
                type="search"
                placeholder="Title or description…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </label>

          {isAnyFilterActive && (
            <button
              type="button"
              className="btn-subtle"
              onClick={resetAllFilters}
              title="Reset all filters"
            >
              <XIcon /> Clear filters
            </button>
          )}

          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreate(true)}
          >
            <PlusIcon /> New work item
          </button>
        </div>
      </section>

      {!me?.user.isGlobalAdmin && teams.length === 0 && !loading && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <p className="muted small" style={{ margin: 0 }}>
            You are not a member of any team yet — ask an admin to add you.
          </p>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="panel" style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
          <RefreshCwIcon
            style={{
              animation: "spin 1s linear infinite",
              color: "var(--primary)",
              marginBottom: "0.5rem",
            }}
          />
          <p aria-label="Loading work items" style={{ margin: 0, color: "var(--text-muted)" }}>
            Loading work items…
          </p>
        </div>
      ) : error ? (
        <div role="alert" className="panel error" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <AlertCircleIcon style={{ color: "#e11d48" }} />
            <p style={{ margin: 0, fontWeight: 500 }}>{error}</p>
          </div>
          <div>
            <button type="button" onClick={() => void load()}>
              <RefreshCwIcon /> Retry
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: "3rem 1rem" }}>
          <FilterIcon style={{ color: "var(--text-muted)", width: 28, height: 28, marginBottom: "0.5rem" }} />
          <p className="muted" style={{ margin: "0 0 1rem 0" }}>
            No work items match these filters.
          </p>
          {isAnyFilterActive ? (
            <button type="button" onClick={resetAllFilters}>
              Reset filters
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
              <PlusIcon /> Create first work item
            </button>
          )}
        </div>
      ) : (
        <div className="table-card">
          {/* Desktop Table View */}
          <div className="table-responsive">
            <table aria-label="Work items">
              <thead>
                <tr>
                  <th style={{ width: "100px" }}>Key</th>
                  <th>Title</th>
                  <th style={{ width: "120px" }}>Status</th>
                  <th style={{ width: "100px" }}>Priority</th>
                  <th className="col-team" style={{ width: "130px" }}>Team</th>
                  <th style={{ width: "150px" }}>Assignee</th>
                  <th className="col-updated" style={{ width: "160px" }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => onOpen(it.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(it.id);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    className="rowlink"
                    title={`Open details for WI-${shortId(it.id)}`}
                  >
                    <td className="mono" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
                      WI-{shortId(it.id)}
                    </td>
                    <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>{it.title}</td>
                    <td>
                      <StatusBadge status={it.status} />
                    </td>
                    <td>
                      <PriorityBadge priority={it.priority} />
                    </td>
                    <td className="col-team" style={{ color: "var(--text-secondary)" }}>
                      {it.team?.name ?? (myTeamIds.has(it.teamId) ? "" : it.teamId)}
                    </td>
                    <td>
                      {it.assignee ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                          <UserIcon style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
                          {it.assignee.name}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontStyle: "italic" }}>
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="col-updated muted small">
                      {new Date(it.updatedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="pager">
            <span aria-live="polite">
              Page {page} of {Math.max(1, totalPages)} ({total} items)
            </span>
            <div className="pager-controls">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Dialog Modal */}
      {isModalOpen && token && (
        <CreateDialog
          token={token}
          teams={teams}
          defaultTeamId={teamId || teams[0]?.id || ""}
          onClose={closeModal}
          onCreated={(id) => {
            closeModal();
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  small,
  interactive,
  active,
  onClick,
}: {
  label: string;
  value: number;
  small?: boolean;
  interactive?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`metric ${small ? "small" : ""} ${interactive ? "interactive" : ""} ${
        active ? "active" : ""
      }`}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
      title={interactive ? `Filter by ${label}` : undefined}
    >
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function CreateDialog({
  token,
  teams,
  defaultTeamId,
  onClose,
  onCreated,
}: {
  token: string;
  teams: Team[];
  defaultTeamId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [teamId, setTeamId] = useState(defaultTeamId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [assigneeId, setAssigneeId] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    apiListMembers(token, teamId)
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
  }, [token, teamId]);

  async function submit() {
    if (!teamId) {
      setError("Choose a team.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiCreateWorkItem(token, {
        teamId,
        title: title.trim(),
        description: description.trim(),
        priority,
        ...(assigneeId ? { assigneeId } : {}),
      });
      onCreated(res.item.id);
    } catch (e) {
      setError(friendlyMessage(e));
      setPending(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create work item"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>New work item</h2>
          <button
            type="button"
            className="dialog-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <XIcon />
          </button>
        </div>

        <label>
          Team
          <select
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setAssigneeId("");
            }}
          >
            <option value="">Select…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Title
          <input
            value={title}
            placeholder="e.g. Resolve payment gateway timeout"
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={pending}
          />
        </label>

        <label>
          Description
          <textarea
            value={description}
            placeholder="Provide context, reproduction steps, or requirements…"
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            disabled={pending}
          />
        </label>

        <div className="row">
          <label style={{ flex: 1 }}>
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              disabled={pending}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label style={{ flex: 1 }}>
            Assignee (must be a team member — enforced by server)
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={pending}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.role})
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p className="error" role="alert" style={{ marginTop: "0.5rem" }}>
            {error}
          </p>
        )}

        <div className="row" style={{ marginTop: "1.25rem", justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void submit()}
            disabled={pending}
          >
            {pending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

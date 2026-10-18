import type { Priority, WorkStatus } from "../api.ts";

export function StatusBadge({ status }: { status: WorkStatus }) {
  return (
    <span
      className={`badge s-${status} badge-status badge-status-${status}`}
      data-status={status}
    >
      <span className="badge-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={`badge p-${priority} badge-priority badge-priority-${priority}`}
      data-priority={priority}
    >
      {priority}
    </span>
  );
}

export function VersionBadge({ version }: { version: number }) {
  return (
    <span className="badge-version mono" title={`Version ${version}`}>
      v{version}
    </span>
  );
}

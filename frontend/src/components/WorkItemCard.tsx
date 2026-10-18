import type { WorkItem } from "../api.ts";
import { PriorityBadge, StatusBadge } from "./Badges.tsx";
import { ClockIcon, UserIcon } from "./Icons.tsx";

export interface WorkItemCardProps {
  item: WorkItem;
  onOpen: (id: string) => void;
  teamName?: string;
}

export function WorkItemCard({ item, onOpen, teamName }: WorkItemCardProps) {
  const shortId = item.id.slice(-6).toUpperCase();
  const displayTeam = item.team?.name ?? teamName ?? item.teamId;

  return (
    <article
      className="work-item-card"
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item.id);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open work item WI-${shortId}: ${item.title}`}
    >
      <div className="card-top-row">
        <span className="mono card-key">WI-{shortId}</span>
        <div className="card-badges">
          <StatusBadge status={item.status} />
          <PriorityBadge priority={item.priority} />
        </div>
      </div>

      <h4 className="card-title">{item.title}</h4>

      <div className="card-meta-row">
        <span className="card-team">{displayTeam}</span>
        <span className="card-meta-divider">·</span>
        <span className="card-assignee">
          <UserIcon className="meta-icon" />
          {item.assignee ? item.assignee.name : "Unassigned"}
        </span>
        <span className="card-meta-divider">·</span>
        <span className="card-time">
          <ClockIcon className="meta-icon" />
          {new Date(item.updatedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </article>
  );
}

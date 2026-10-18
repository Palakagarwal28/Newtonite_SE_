import type { WorkStatus } from "@prisma/client";

/**
 * Explicit workflow transition matrix (M1.2). Enforced in backend business
 * logic (`service.ts`), never in the frontend.
 *
 * Rationale: a small linear flow with escape hatches. BLOCKED can be resolved
 * (→ IN_PROGRESS) or dropped (→ CLOSED). IN_REVIEW is the approval gate:
 * approve → DONE, rework → IN_PROGRESS, newly found blocker → BLOCKED.
 * DONE/CLOSED can be reopened (→ IN_PROGRESS) because incidents regress.
 * Same-status "transitions" are accepted as no-ops at the service layer.
 */
export const STATUS_TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  OPEN: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["BLOCKED", "IN_REVIEW"],
  BLOCKED: ["IN_PROGRESS", "CLOSED"],
  IN_REVIEW: ["IN_PROGRESS", "DONE", "BLOCKED"],
  DONE: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

export function isValidTransition(from: WorkStatus, to: WorkStatus): boolean {
  if (from === to) return true;
  return STATUS_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: WorkStatus): WorkStatus[] {
  return [...STATUS_TRANSITIONS[from]];
}

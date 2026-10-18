import type { Membership, Role, WorkStatus } from "./api.ts";

/**
 * DISPLAY-ONLY mirrors of backend rules. Hidden/disabled controls are a UX
 * convenience — every action is re-authorized server-side, so these helpers
 * must never be treated as a security boundary.
 */

/** Exact copy of backend STATUS_TRANSITIONS (backend/src/work-items/transitions.ts). */
export const STATUS_TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  OPEN: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["BLOCKED", "IN_REVIEW"],
  BLOCKED: ["IN_PROGRESS", "CLOSED"],
  IN_REVIEW: ["IN_PROGRESS", "DONE", "BLOCKED"],
  DONE: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

export function allowedTransitions(from: WorkStatus): WorkStatus[] {
  return [...(STATUS_TRANSITIONS[from] ?? [])];
}

export function roleInTeam(memberships: Membership[], teamId: string): Role | null {
  return memberships.find((m) => m.teamId === teamId)?.role ?? null;
}

/** Status/assignment controls are shown for MANAGER+ (server still decides). */
export function canTransitionOrAssign(
  isGlobalAdmin: boolean,
  memberships: Membership[],
  teamId: string,
): boolean {
  if (isGlobalAdmin) return true;
  const role = roleInTeam(memberships, teamId);
  return role === "ADMIN" || role === "MANAGER";
}

export function isMember(memberships: Membership[], teamId: string): boolean {
  return memberships.some((m) => m.teamId === teamId);
}

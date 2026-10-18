import type { Role } from "@prisma/client";

/**
 * Permission matrix (M1.1). Columns are deliberately NOT interchangeable:
 * - globalAdmin: platform-level flag on User (can create teams, see any team).
 * - team ADMIN: administers membership within ONE team only.
 * - MANAGER: reads team data, no membership management (work-item powers arrive in M1.2+).
 * - MEMBER: read-only team access.
 * - outsider: authenticated user with no membership in the team.
 */
export const PERMISSION_MATRIX = {
  "teams:create": {
    globalAdmin: true,
    ADMIN: false,
    MANAGER: false,
    MEMBER: false,
    outsider: false,
  },
  "teams:view": {
    globalAdmin: true,
    ADMIN: true,
    MANAGER: true,
    MEMBER: true,
    outsider: false,
  },
  "teams:listMembers": {
    globalAdmin: true,
    ADMIN: true,
    MANAGER: true,
    MEMBER: true,
    outsider: false,
  },
  "teams:addMember": {
    globalAdmin: true,
    ADMIN: true,
    MANAGER: false,
    MEMBER: false,
    outsider: false,
  },
  "teams:removeMember": {
    globalAdmin: true,
    ADMIN: true,
    MANAGER: false,
    MEMBER: false,
    outsider: false,
  },
} as const;

export type PermissionAction = keyof typeof PERMISSION_MATRIX;

export function canCreateTeam(isGlobalAdmin: boolean): boolean {
  return PERMISSION_MATRIX["teams:create"].globalAdmin && isGlobalAdmin;
}

export function canViewTeam(isGlobalAdmin: boolean, role: Role | null): boolean {
  if (isGlobalAdmin) return true;
  return role !== null;
}

export function canManageMembers(isGlobalAdmin: boolean, role: Role | null): boolean {
  if (isGlobalAdmin) return true;
  return role === "ADMIN";
}

/** Single entry point used by unit tests to lock the matrix against accidental changes. */
export function checkPermission(
  action: PermissionAction,
  ctx: { isGlobalAdmin: boolean; role: Role | null },
): boolean {
  switch (action) {
    case "teams:create":
      return canCreateTeam(ctx.isGlobalAdmin);
    case "teams:view":
    case "teams:listMembers":
      return canViewTeam(ctx.isGlobalAdmin, ctx.role);
    case "teams:addMember":
    case "teams:removeMember":
      return canManageMembers(ctx.isGlobalAdmin, ctx.role);
  }
}

// ---------------------------------------------------------------------------
// Work-item rules (M1.2, additive — PERMISSION_MATRIX above is unchanged).
// Any team member can create/read/edit fields/comment; status transitions and
// assignment additionally require MANAGER or ADMIN (or global admin).
// ---------------------------------------------------------------------------

/** Human-readable form of the work-item rules; the functions below enforce them. */
export const WORK_ITEM_RULES = {
  "work-items:create": "member (any role) or global admin",
  "work-items:view": "member (any role) or global admin",
  "work-items:editFields": "member (any role) or global admin",
  "work-items:comment": "member (any role) or global admin",
  "work-items:changeStatusOrAssignee": "team ADMIN/MANAGER or global admin",
} as const;

export function canCreateWorkItem(isGlobalAdmin: boolean, role: Role | null): boolean {
  return isGlobalAdmin || role !== null;
}

export function canViewWorkItem(isGlobalAdmin: boolean, role: Role | null): boolean {
  return isGlobalAdmin || role !== null;
}

export function canEditWorkItemFields(isGlobalAdmin: boolean, role: Role | null): boolean {
  return isGlobalAdmin || role !== null;
}

export function canCommentOnWorkItem(isGlobalAdmin: boolean, role: Role | null): boolean {
  return isGlobalAdmin || role !== null;
}

export function canTransitionOrAssign(isGlobalAdmin: boolean, role: Role | null): boolean {
  if (isGlobalAdmin) return true;
  return role === "ADMIN" || role === "MANAGER";
}

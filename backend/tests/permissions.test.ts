import { describe, expect, it } from "vitest";
import {
  PERMISSION_MATRIX,
  canCreateTeam,
  canManageMembers,
  canViewTeam,
  checkPermission,
} from "../src/auth/permissions.js";

/**
 * Pure unit tests — no database. Lock the documented matrix so a future
 * refactor cannot silently widen access.
 */
describe("permission matrix", () => {
  it("matches the documented matrix exactly", () => {
    expect(PERMISSION_MATRIX).toEqual({
      "teams:create": { globalAdmin: true, ADMIN: false, MANAGER: false, MEMBER: false, outsider: false },
      "teams:view": { globalAdmin: true, ADMIN: true, MANAGER: true, MEMBER: true, outsider: false },
      "teams:listMembers": { globalAdmin: true, ADMIN: true, MANAGER: true, MEMBER: true, outsider: false },
      "teams:addMember": { globalAdmin: true, ADMIN: true, MANAGER: false, MEMBER: false, outsider: false },
      "teams:removeMember": { globalAdmin: true, ADMIN: true, MANAGER: false, MEMBER: false, outsider: false },
    });
  });

  it("keeps global admin and team ADMIN distinct", () => {
    // A team ADMIN cannot create teams; only a global admin can.
    expect(canCreateTeam(false)).toBe(false);
    expect(canCreateTeam(true)).toBe(true);
    expect(checkPermission("teams:create", { isGlobalAdmin: false, role: "ADMIN" })).toBe(false);
  });

  it("grants view to members, denies outsiders unless global admin", () => {
    expect(canViewTeam(false, "MEMBER")).toBe(true);
    expect(canViewTeam(false, "MANAGER")).toBe(true);
    expect(canViewTeam(false, "ADMIN")).toBe(true);
    expect(canViewTeam(false, null)).toBe(false);
    expect(canViewTeam(true, null)).toBe(true);
  });

  it("restricts membership management to team ADMINs and global admins", () => {
    expect(canManageMembers(false, "ADMIN")).toBe(true);
    expect(canManageMembers(false, "MANAGER")).toBe(false);
    expect(canManageMembers(false, "MEMBER")).toBe(false);
    expect(canManageMembers(false, null)).toBe(false);
    expect(canManageMembers(true, null)).toBe(true);
  });
});

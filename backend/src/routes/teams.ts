import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { canCreateTeam, canManageMembers, canViewTeam } from "../auth/permissions.js";
import { asyncHandler, HttpError, sendError } from "../lib/http-error.js";

const createTeamSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

const addMemberSchema = z
  .object({
    userId: z.string().trim().min(1).max(64).optional(),
    email: z.string().trim().toLowerCase().email().max(255).optional(),
    role: z.enum(["ADMIN", "MANAGER", "MEMBER"]),
  })
  .strict()
  .refine((v) => v.userId !== undefined || v.email !== undefined, {
    message: "Either userId or email is required",
  });

function validationError(e: z.ZodError, res: Response) {
  sendError(res, 400, "VALIDATION_ERROR", "Invalid request body", e.flatten().fieldErrors);
}

export const teamsRouter = Router();

// All team resources require authentication. Authorization is then checked per team.
teamsRouter.use(requireAuth);

/** Teams the caller can see: own memberships, or everything for a global admin. */
teamsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    if (me.isGlobalAdmin) {
      const teams = await prisma.team.findMany({ orderBy: { name: "asc" } });
      const memberships = await prisma.membership.findMany({ where: { userId: me.id } });
      const roleByTeam = new Map(memberships.map((m) => [m.teamId, m.role]));
      res.status(200).json({
        teams: teams.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          role: roleByTeam.get(t.id) ?? null,
        })),
      });
      return;
    }
    const memberships = await prisma.membership.findMany({
      where: { userId: me.id },
      include: { team: true },
      orderBy: { createdAt: "asc" },
    });
    res.status(200).json({
      teams: memberships.map((m) => ({
        id: m.team.id,
        name: m.team.name,
        description: m.team.description,
        role: m.role,
      })),
    });
  }),
);

/** Global admins only — team ADMINs cannot create teams (see permission matrix). */
teamsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    if (!canCreateTeam(me.isGlobalAdmin)) {
      throw new HttpError(403, "ROLE_REQUIRED", "Only global administrators can create teams");
    }
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const existing = await prisma.team.findUnique({ where: { name: parsed.data.name } });
    if (existing) {
      throw new HttpError(409, "TEAM_NAME_TAKEN", "A team with this name already exists");
    }
    // Creator joins as team ADMIN so the team is never orphaned without an admin.
    const team = await prisma.team.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        memberships: { create: { userId: me.id, role: "ADMIN" } },
      },
    });
    res.status(201).json({
      team: { id: team.id, name: team.name, description: team.description, role: "ADMIN" as const },
    });
  }),
);

async function loadTeamOr404(teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new HttpError(404, "TEAM_NOT_FOUND", "Team not found");
  return team;
}

/** Guessing another team's id yields 403 (team exists) — never the team's data. */
teamsRouter.get(
  "/:teamId",
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const team = await loadTeamOr404(req.params.teamId);
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: me.id, teamId: team.id } },
    });
    if (!canViewTeam(me.isGlobalAdmin, membership?.role ?? null)) {
      throw new HttpError(403, "TEAM_ACCESS_DENIED", "You are not a member of this team");
    }
    res.status(200).json({
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        role: me.isGlobalAdmin ? (membership?.role ?? null) : (membership?.role ?? null),
      },
    });
  }),
);

teamsRouter.get(
  "/:teamId/members",
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const team = await loadTeamOr404(req.params.teamId);
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: me.id, teamId: team.id } },
    });
    if (!canViewTeam(me.isGlobalAdmin, membership?.role ?? null)) {
      throw new HttpError(403, "TEAM_ACCESS_DENIED", "You are not a member of this team");
    }
    const members = await prisma.membership.findMany({
      where: { teamId: team.id },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.status(200).json({
      members: members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
      })),
    });
  }),
);

teamsRouter.post(
  "/:teamId/members",
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const team = await loadTeamOr404(req.params.teamId);
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: me.id, teamId: team.id } },
    });
    if (!canManageMembers(me.isGlobalAdmin, membership?.role ?? null)) {
      throw new HttpError(
        403,
        "ROLE_REQUIRED",
        "Only team ADMINs (or global admins) can manage members",
      );
    }
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const target = parsed.data.userId
      ? await prisma.user.findUnique({ where: { id: parsed.data.userId } })
      : await prisma.user.findUnique({ where: { email: parsed.data.email! } });
    if (!target) throw new HttpError(404, "USER_NOT_FOUND", "User not found");

    const already = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: target.id, teamId: team.id } },
    });
    if (already) throw new HttpError(409, "MEMBERSHIP_EXISTS", "User is already a team member");

    const created = await prisma.membership.create({
      data: { userId: target.id, teamId: team.id, role: parsed.data.role },
    });
    res.status(201).json({
      membership: { teamId: team.id, userId: target.id, role: created.role },
    });
  }),
);

teamsRouter.delete(
  "/:teamId/members/:userId",
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const team = await loadTeamOr404(req.params.teamId);
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: me.id, teamId: team.id } },
    });
    if (!canManageMembers(me.isGlobalAdmin, membership?.role ?? null)) {
      throw new HttpError(
        403,
        "ROLE_REQUIRED",
        "Only team ADMINs (or global admins) can manage members",
      );
    }
    const target = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: req.params.userId, teamId: team.id } },
    });
    if (!target) throw new HttpError(404, "MEMBERSHIP_NOT_FOUND", "Membership not found");

    // Never orphan a team without an administrator.
    if (target.role === "ADMIN") {
      const adminCount = await prisma.membership.count({
        where: { teamId: team.id, role: "ADMIN" },
      });
      if (adminCount <= 1) {
        throw new HttpError(
          409,
          "CANNOT_REMOVE_LAST_ADMIN",
          "Cannot remove the last ADMIN of a team",
        );
      }
    }
    await prisma.membership.delete({
      where: { userId_teamId: { userId: target.userId, teamId: team.id } },
    });
    res.status(200).json({ removed: { teamId: team.id, userId: target.userId } });
  }),
);

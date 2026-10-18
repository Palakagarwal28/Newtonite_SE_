import {
  Prisma,
  type Priority,
  type Role,
  type WorkItem,
  type WorkStatus,
} from "@prisma/client";
import type { AuthUser } from "../auth/middleware.js";
import {
  canCommentOnWorkItem,
  canCreateWorkItem,
  canEditWorkItemFields,
  canTransitionOrAssign,
  canViewWorkItem,
} from "../auth/permissions.js";
import { prisma } from "../db.js";
import { HttpError } from "../lib/http-error.js";
import type {
  CreateWorkItemInput,
  ListWorkItemsQuery,
  UpdateWorkItemInput,
} from "./schemas.js";
import { allowedTransitions, isValidTransition } from "./transitions.js";

type Tx = Prisma.TransactionClient;

export const ACTIVITY = {
  CREATED: "CREATED",
  UPDATED: "UPDATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  ASSIGNED: "ASSIGNED",
  UNASSIGNED: "UNASSIGNED",
  PRIORITY_CHANGED: "PRIORITY_CHANGED",
  COMMENTED: "COMMENTED",
} as const;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

async function teamRole(
  db: Tx | typeof prisma,
  userId: string,
  teamId: string,
): Promise<Role | null> {
  const m = await db.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  return m?.role ?? null;
}

async function requireTeamView(me: AuthUser, teamId: string): Promise<{ role: Role | null }> {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new HttpError(404, "TEAM_NOT_FOUND", "Team not found");
  const role = await teamRole(prisma, me.id, teamId);
  if (!canViewWorkItem(me.isGlobalAdmin, role)) {
    throw new HttpError(403, "TEAM_ACCESS_DENIED", "You are not a member of this team");
  }
  return { role };
}

async function requireItem(me: AuthUser, id: string) {
  const item = await prisma.workItem.findUnique({
    where: { id },
    include: {
      team: { select: { id: true, name: true } },
      assignee: { select: { id: true, email: true, name: true } },
      createdBy: { select: { id: true, email: true, name: true } },
    },
  });
  if (!item) throw new HttpError(404, "WORK_ITEM_NOT_FOUND", "Work item not found");
  const role = await teamRole(prisma, me.id, item.teamId);
  if (!canViewWorkItem(me.isGlobalAdmin, role)) {
    // Same convention as teams: cross-team guess yields 403, never the data.
    throw new HttpError(403, "TEAM_ACCESS_DENIED", "You are not a member of this team");
  }
  return { item, role };
}

async function requireAssigneeInTeam(tx: Tx, assigneeId: string, teamId: string) {
  const membership = await tx.membership.findUnique({
    where: { userId_teamId: { userId: assigneeId, teamId } },
  });
  if (!membership) {
    throw new HttpError(
      422,
      "ASSIGNEE_NOT_TEAM_MEMBER",
      "Assignee must be a member of the work item's team",
    );
  }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export function toWorkItemDTO(
  item: WorkItem & {
    team?: { id: string; name: string } | null;
    assignee?: { id: string; email: string; name: string } | null;
    createdBy?: { id: string; email: string; name: string } | null;
  },
) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    version: item.version,
    teamId: item.teamId,
    team: item.team ?? undefined,
    assigneeId: item.assigneeId,
    assignee: item.assignee ?? null,
    createdById: item.createdById,
    createdBy: item.createdBy ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createWorkItem(me: AuthUser, input: CreateWorkItemInput) {
  const { role } = await requireTeamView(me, input.teamId);
  if (!canCreateWorkItem(me.isGlobalAdmin, role)) {
    throw new HttpError(403, "TEAM_ACCESS_DENIED", "You are not a member of this team");
  }
  // createdById is ALWAYS the authenticated actor — the schema has no such field.
  return prisma.$transaction(async (tx) => {
    if (input.assigneeId) await requireAssigneeInTeam(tx, input.assigneeId, input.teamId);
    const item = await tx.workItem.create({
      data: {
        title: input.title,
        description: input.description,
        status: "OPEN",
        priority: input.priority,
        teamId: input.teamId,
        assigneeId: input.assigneeId ?? null,
        createdById: me.id,
      },
      include: {
        team: { select: { id: true, name: true } },
        assignee: { select: { id: true, email: true, name: true } },
        createdBy: { select: { id: true, email: true, name: true } },
      },
    });
    await tx.activityEvent.create({
      data: {
        workItemId: item.id,
        actorId: me.id,
        action: ACTIVITY.CREATED,
        version: item.version,
        detail: {
          title: item.title,
          status: item.status,
          priority: item.priority,
          assigneeId: item.assigneeId,
        },
      },
    });
    return toWorkItemDTO(item);
  });
}

// ---------------------------------------------------------------------------
// List (database-side filtering, bounded pages, deterministic order)
// ---------------------------------------------------------------------------

export async function listWorkItems(me: AuthUser, query: ListWorkItemsQuery) {
  if (query.mine && query.assigneeId && query.assigneeId !== me.id) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Conflicting filters: mine=true with a different assigneeId",
    );
  }

  const where: Prisma.WorkItemWhereInput = {};
  if (query.teamId) {
    await requireTeamView(me, query.teamId);
    where.teamId = query.teamId;
  } else if (!me.isGlobalAdmin) {
    const memberships = await prisma.membership.findMany({
      where: { userId: me.id },
      select: { teamId: true },
    });
    where.teamId = { in: memberships.map((m) => m.teamId) };
  }
  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.mine) where.assigneeId = me.id;
  else if (query.assigneeId) where.assigneeId = query.assigneeId;
  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
    ];
  }

  const { page, pageSize } = query;
  const [total, rows] = await prisma.$transaction([
    prisma.workItem.count({ where }),
    prisma.workItem.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        team: { select: { id: true, name: true } },
        assignee: { select: { id: true, email: true, name: true } },
      },
    }),
  ]);
  return {
    items: rows.map(toWorkItemDTO),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ---------------------------------------------------------------------------
// Retrieve with relevant details
// ---------------------------------------------------------------------------

export async function getWorkItem(me: AuthUser, id: string) {
  const { item } = await requireItem(me, id);
  const [recentComments, commentCount, activityCount] = await prisma.$transaction([
    prisma.comment.findMany({
      where: { workItemId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      include: { author: { select: { id: true, email: true, name: true } } },
    }),
    prisma.comment.count({ where: { workItemId: id } }),
    prisma.activityEvent.count({ where: { workItemId: id } }),
  ]);
  return {
    ...toWorkItemDTO(item),
    // Latest 10, returned oldest-first for readability.
    recentComments: [...recentComments].reverse().map((c) => ({
      id: c.id,
      body: c.body,
      authorId: c.authorId,
      author: c.author,
      createdAt: c.createdAt,
    })),
    commentCount,
    activityCount,
  };
}

// ---------------------------------------------------------------------------
// Update with atomic optimistic concurrency
// ---------------------------------------------------------------------------

export async function updateWorkItem(me: AuthUser, id: string, input: UpdateWorkItemInput) {
  const { item: current, role } = await requireItem(me, id);

  const wantsStatusChange = input.status !== undefined && input.status !== current.status;
  const wantsAssigneeChange =
    input.assigneeId !== undefined && (input.assigneeId ?? null) !== current.assigneeId;
  if ((wantsStatusChange || wantsAssigneeChange) && !canTransitionOrAssign(me.isGlobalAdmin, role)) {
    throw new HttpError(
      403,
      "ROLE_REQUIRED",
      "Only team MANAGERs, ADMINs (or global admins) can change status or assignment",
    );
  }
  if (!canEditWorkItemFields(me.isGlobalAdmin, role)) {
    throw new HttpError(403, "TEAM_ACCESS_DENIED", "You are not a member of this team");
  }

  if (wantsStatusChange && !isValidTransition(current.status, input.status as WorkStatus)) {
    throw new HttpError(422, "INVALID_STATUS_TRANSITION", `Cannot transition ${current.status} → ${input.status}`, {
      from: current.status,
      to: input.status,
      allowed: allowedTransitions(current.status),
    });
  }

  const wantsPriorityChange = input.priority !== undefined && input.priority !== current.priority;
  const wantsTitleChange = input.title !== undefined && input.title !== current.title;
  const wantsDescriptionChange =
    input.description !== undefined && input.description !== current.description;

  // Idempotent retry: identical values → 200 with the current version, no write, no events.
  // (Helps the brief's "user repeating an action because unsure it succeeded".)
  if (
    !wantsStatusChange &&
    !wantsAssigneeChange &&
    !wantsPriorityChange &&
    !wantsTitleChange &&
    !wantsDescriptionChange
  ) {
    return toWorkItemDTO(current);
  }

  return prisma.$transaction(async (tx) => {
    if (input.assigneeId && wantsAssigneeChange) {
      await requireAssigneeInTeam(tx, input.assigneeId, current.teamId);
    }
    // ATOMIC conditional write: matches id AND expected version, bumps version.
    // Two concurrent requests with the same expectedVersion → exactly one wins.
    const res = await tx.workItem.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority as Priority } : {}),
        ...(input.status !== undefined ? { status: input.status as WorkStatus } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count === 0) {
      // No write happened and nothing below runs — the item and history are untouched.
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        "Work item was modified by someone else — reload and retry",
        { expectedVersion: input.expectedVersion, currentVersion: current.version },
      );
    }
    const nextVersion = input.expectedVersion + 1;
    const events: Prisma.ActivityEventCreateManyInput[] = [];
    if (wantsStatusChange) {
      events.push({
        workItemId: id,
        actorId: me.id,
        action: ACTIVITY.STATUS_CHANGED,
        version: nextVersion,
        detail: { before: current.status, after: input.status },
      });
    }
    if (wantsAssigneeChange) {
      events.push({
        workItemId: id,
        actorId: me.id,
        action: input.assigneeId ? ACTIVITY.ASSIGNED : ACTIVITY.UNASSIGNED,
        version: nextVersion,
        detail: { before: current.assigneeId, after: input.assigneeId ?? null },
      });
    }
    if (wantsPriorityChange) {
      events.push({
        workItemId: id,
        actorId: me.id,
        action: ACTIVITY.PRIORITY_CHANGED,
        version: nextVersion,
        detail: { before: current.priority, after: input.priority },
      });
    }
    if (wantsTitleChange || wantsDescriptionChange) {
      events.push({
        workItemId: id,
        actorId: me.id,
        action: ACTIVITY.UPDATED,
        version: nextVersion,
        detail: {
          ...(wantsTitleChange ? { title: { before: current.title, after: input.title } } : {}),
          ...(wantsDescriptionChange
            ? { descriptionChanged: true }
            : {}),
        },
      });
    }
    if (events.length > 0) await tx.activityEvent.createMany({ data: events });
    const updated = await tx.workItem.findUniqueOrThrow({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        assignee: { select: { id: true, email: true, name: true } },
        createdBy: { select: { id: true, email: true, name: true } },
      },
    });
    return toWorkItemDTO(updated);
  });
}

// ---------------------------------------------------------------------------
// Comments (atomic with audit; do NOT bump the item version)
// ---------------------------------------------------------------------------

export async function addComment(me: AuthUser, id: string, body: string) {
  const { role } = await requireItem(me, id);
  if (!canCommentOnWorkItem(me.isGlobalAdmin, role)) {
    throw new HttpError(403, "TEAM_ACCESS_DENIED", "You are not a member of this team");
  }
  return prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: { workItemId: id, authorId: me.id, body },
      include: { author: { select: { id: true, email: true, name: true } } },
    });
    const item = await tx.workItem.findUniqueOrThrow({ where: { id } });
    await tx.activityEvent.create({
      data: {
        workItemId: id,
        actorId: me.id,
        action: ACTIVITY.COMMENTED,
        version: item.version,
        detail: { commentId: comment.id, excerpt: body.slice(0, 200) },
      },
    });
    return {
      id: comment.id,
      body: comment.body,
      authorId: comment.authorId,
      author: comment.author,
      createdAt: comment.createdAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Activity history (paginated, newest first)
// ---------------------------------------------------------------------------

export async function listActivity(me: AuthUser, id: string, page: number, pageSize: number) {
  await requireItem(me, id);
  const where = { workItemId: id };
  const [total, rows] = await prisma.$transaction([
    prisma.activityEvent.count({ where }),
    prisma.activityEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, email: true, name: true } } },
    }),
  ]);
  return {
    events: rows.map((e) => ({
      id: e.id,
      action: e.action,
      actorId: e.actorId,
      actor: e.actor,
      detail: e.detail,
      version: e.version,
      createdAt: e.createdAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

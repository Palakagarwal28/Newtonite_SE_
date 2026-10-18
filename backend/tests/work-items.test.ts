import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import {
  addMembership,
  auth,
  createTeam,
  createUser,
  createWorkItemViaApi,
  deleteTeamCascade,
  prisma,
  type TestIdentity,
} from "./helpers.js";

// Leftover rows from a failed test are uniquely-named and harmless; the happy
// path cleans up every team it creates (items cascade to comments/activity).

afterAll(async () => {
  await prisma.$disconnect();
});

interface Ctx {
  teamId: string;
  otherTeamId: string;
  admin: TestIdentity;
  manager: TestIdentity;
  member: TestIdentity;
  outsider: TestIdentity;
}

async function setup(app: Express): Promise<Ctx> {
  const team = await createTeam("WI-Team");
  const otherTeam = await createTeam("WI-Other");
  const admin = await createUser(app, { prefix: "wiadmin" });
  const manager = await createUser(app, { prefix: "wimgr" });
  const member = await createUser(app, { prefix: "wimem" });
  const outsider = await createUser(app, { prefix: "wiout" });
  await addMembership(admin.id, team.id, "ADMIN");
  await addMembership(manager.id, team.id, "MANAGER");
  await addMembership(member.id, team.id, "MEMBER");
  return { teamId: team.id, otherTeamId: otherTeam.id, admin, manager, member, outsider };
}

describe("POST /api/work-items + GET /api/work-items/:id", () => {
  it("creates as the authenticated actor and retrieves with details", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const created = await request(app)
        .post("/api/work-items")
        .set(auth(ctx.member.token))
        .send({ teamId: ctx.teamId, title: "Investigate payout", description: "Details here" });

      expect(created.status).toBe(201);
      expect(created.body.item.version).toBe(1);
      expect(created.body.item.status).toBe("OPEN");
      expect(created.body.item.createdById).toBe(ctx.member.id);
      expect(created.body.item.assigneeId).toBeNull();

      const got = await request(app)
        .get(`/api/work-items/${created.body.item.id}`)
        .set(auth(ctx.member.token));
      expect(got.status).toBe(200);
      expect(got.body.id).toBe(created.body.item.id);
      expect(got.body.team.id).toBe(ctx.teamId);
      expect(got.body.commentCount).toBe(0);
      expect(got.body.activityCount).toBe(1);
      expect(got.body.recentComments).toEqual([]);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });

  it("rejects a client-supplied creator id and validates input", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const spoof = await request(app)
        .post("/api/work-items")
        .set(auth(ctx.member.token))
        .send({
          teamId: ctx.teamId,
          title: "Spoof",
          description: "x",
          createdById: ctx.outsider.id,
        });
      expect(spoof.status).toBe(400);
      expect(spoof.body.error.code).toBe("VALIDATION_ERROR");

      const bad = await request(app)
        .post("/api/work-items")
        .set(auth(ctx.member.token))
        .send({ teamId: ctx.teamId, title: "", description: "x" });
      expect(bad.status).toBe(400);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });

  it("denies unauthenticated, outsider, and cross-team access", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const item = await createWorkItemViaApi(app, ctx.member.token, ctx.teamId);

      const anon = await request(app).get(`/api/work-items/${item.id}`);
      expect(anon.status).toBe(401);

      const outsiderCreate = await request(app)
        .post("/api/work-items")
        .set(auth(ctx.outsider.token))
        .send({ teamId: ctx.teamId, title: "Nope", description: "Nope" });
      expect(outsiderCreate.status).toBe(403);

      const outsiderGet = await request(app)
        .get(`/api/work-items/${item.id}`)
        .set(auth(ctx.outsider.token));
      expect(outsiderGet.status).toBe(403);
      expect(outsiderGet.body.item).toBeUndefined();

      // Member of no team in the other team either: cross-team by guessed id.
      const stranger = await createUser(app, { prefix: "wistranger" });
      await addMembership(stranger.id, ctx.otherTeamId, "MEMBER");
      const cross = await request(app)
        .get(`/api/work-items/${item.id}`)
        .set(auth(stranger.token));
      expect(cross.status).toBe(403);

      const missing = await request(app)
        .get("/api/work-items/item-that-does-not-exist")
        .set(auth(ctx.member.token));
      expect(missing.status).toBe(404);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });
});

describe("assignment rules", () => {
  it("rejects assignment to non-members; restricts who can assign", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const badCreate = await request(app)
        .post("/api/work-items")
        .set(auth(ctx.manager.token))
        .send({
          teamId: ctx.teamId,
          title: "Bad assign",
          description: "x",
          assigneeId: ctx.outsider.id,
        });
      expect(badCreate.status).toBe(422);
      expect(badCreate.body.error.code).toBe("ASSIGNEE_NOT_TEAM_MEMBER");

      const item = await createWorkItemViaApi(app, ctx.member.token, ctx.teamId);

      // Plain MEMBER cannot assign, even to themselves.
      const byMember = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token))
        .send({ expectedVersion: 1, assigneeId: ctx.member.id });
      expect(byMember.status).toBe(403);
      expect(byMember.body.error.code).toBe("ROLE_REQUIRED");

      // MANAGER can assign a member…
      const byManager = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.manager.token))
        .send({ expectedVersion: 1, assigneeId: ctx.member.id });
      expect(byManager.status).toBe(200);
      expect(byManager.body.item.assigneeId).toBe(ctx.member.id);
      expect(byManager.body.item.version).toBe(2);

      // …but not an outsider.
      const toOutsider = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.manager.token))
        .send({ expectedVersion: 2, assigneeId: ctx.outsider.id });
      expect(toOutsider.status).toBe(422);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });
});

describe("status transitions", () => {
  it("accepts legal transitions and rejects jumps with 422", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const item = await createWorkItemViaApi(app, ctx.member.token, ctx.teamId);

      const ok = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.manager.token))
        .send({ expectedVersion: 1, status: "IN_PROGRESS" });
      expect(ok.status).toBe(200);
      expect(ok.body.item.status).toBe("IN_PROGRESS");

      // IN_PROGRESS → DONE skips IN_REVIEW: illegal.
      const jump = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.manager.token))
        .send({ expectedVersion: 2, status: "DONE" });
      expect(jump.status).toBe(422);
      expect(jump.body.error.code).toBe("INVALID_STATUS_TRANSITION");
      expect(jump.body.error.details.allowed).toContain("IN_REVIEW");

      // Plain MEMBER cannot transition at all.
      const byMember = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token))
        .send({ expectedVersion: 2, status: "BLOCKED" });
      expect(byMember.status).toBe(403);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });
});

describe("optimistic concurrency", () => {
  it("returns 409 for stale versions and leaves item + history unchanged", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const item = await createWorkItemViaApi(app, ctx.member.token, ctx.teamId);

      const first = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token))
        .send({ expectedVersion: 1, title: "First write wins" });
      expect(first.status).toBe(200);
      expect(first.body.item.version).toBe(2);

      const before = await request(app)
        .get(`/api/work-items/${item.id}/activity`)
        .set(auth(ctx.member.token));
      const activityBefore = before.body.total as number;

      const stale = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token))
        .send({ expectedVersion: 1, title: "Stale write" });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("VERSION_CONFLICT");

      const after = await request(app)
        .get(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token));
      expect(after.body.version).toBe(2);
      expect(after.body.title).toBe("First write wins");

      const activityAfter = await request(app)
        .get(`/api/work-items/${item.id}/activity`)
        .set(auth(ctx.member.token));
      expect(activityAfter.body.total).toBe(activityBefore);

      // Missing expectedVersion is a 400, not a silent overwrite.
      const noVersion = await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token))
        .send({ title: "No token" });
      expect(noVersion.status).toBe(400);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });

  it("lets exactly one of two concurrent same-version updates succeed (real Postgres)", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const item = await createWorkItemViaApi(app, ctx.member.token, ctx.teamId);

      const [a, b] = await Promise.all([
        request(app)
          .patch(`/api/work-items/${item.id}`)
          .set(auth(ctx.member.token))
          .send({ expectedVersion: 1, title: "Racer A" }),
        request(app)
          .patch(`/api/work-items/${item.id}`)
          .set(auth(ctx.member.token))
          .send({ expectedVersion: 1, title: "Racer B" }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);

      const final = await request(app)
        .get(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token));
      expect(final.body.version).toBe(2);
      expect(["Racer A", "Racer B"]).toContain(final.body.title);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });
});

describe("comments + activity", () => {
  it("records comments atomically without bumping version; enforces auth", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const item = await createWorkItemViaApi(app, ctx.member.token, ctx.teamId);

      const comment = await request(app)
        .post(`/api/work-items/${item.id}/comments`)
        .set(auth(ctx.member.token))
        .send({ body: "Found the root cause" });
      expect(comment.status).toBe(201);
      expect(comment.body.comment.authorId).toBe(ctx.member.id);

      const detail = await request(app)
        .get(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token));
      expect(detail.body.version).toBe(1); // comments don't invalidate in-flight edits
      expect(detail.body.commentCount).toBe(1);

      const activity = await request(app)
        .get(`/api/work-items/${item.id}/activity`)
        .set(auth(ctx.member.token));
      const actions = (activity.body.events as Array<{ action: string }>).map((e) => e.action);
      expect(actions).toContain("COMMENTED");
      expect(actions).toContain("CREATED");
      const commented = activity.body.events.find(
        (e: { action: string }) => e.action === "COMMENTED",
      );
      expect(commented.actorId).toBe(ctx.member.id);
      expect(commented.detail.excerpt).toContain("root cause");

      const outsider = await request(app)
        .post(`/api/work-items/${item.id}/comments`)
        .set(auth(ctx.outsider.token))
        .send({ body: "Snoop" });
      expect(outsider.status).toBe(403);

      const anon = await request(app)
        .post(`/api/work-items/${item.id}/comments`)
        .send({ body: "Snoop" });
      expect(anon.status).toBe(401);

      const empty = await request(app)
        .post(`/api/work-items/${item.id}/comments`)
        .set(auth(ctx.member.token))
        .send({ body: "  " });
      expect(empty.status).toBe(400);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });

  it("paginates activity newest-first", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const item = await createWorkItemViaApi(app, ctx.member.token, ctx.teamId);
      await request(app)
        .patch(`/api/work-items/${item.id}`)
        .set(auth(ctx.member.token))
        .send({ expectedVersion: 1, title: "v2" });
      await request(app)
        .post(`/api/work-items/${item.id}/comments`)
        .set(auth(ctx.member.token))
        .send({ body: "note" });

      const page1 = await request(app)
        .get(`/api/work-items/${item.id}/activity?page=1&pageSize=2`)
        .set(auth(ctx.member.token));
      expect(page1.status).toBe(200);
      expect(page1.body.events.length).toBe(2);
      expect(page1.body.total).toBe(3);
      expect(page1.body.totalPages).toBe(2);
      const t0 = new Date(page1.body.events[0].createdAt).getTime();
      const t1 = new Date(page1.body.events[1].createdAt).getTime();
      expect(t0).toBeGreaterThanOrEqual(t1);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });
});

describe("list pagination + filtering", () => {
  it("filters by status/priority/assignee/search with bounded deterministic pages", async () => {
    const app = createApp();
    const ctx = await setup(app);
    try {
      const prefix = `Pagetest-${Date.now()}`;
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post("/api/work-items")
          .set(auth(ctx.member.token))
          .send({
            teamId: ctx.teamId,
            title: `${prefix} item ${i}`,
            description: "filter body",
            priority: i < 2 ? "URGENT" : "LOW",
          });
      }
      // Transition two items to IN_PROGRESS (scoped by search below).
      const all = await request(app)
        .get(`/api/work-items?teamId=${ctx.teamId}&q=${prefix}&pageSize=10`)
        .set(auth(ctx.member.token));
      const ids = (all.body.items as Array<{ id: string; version: number }>).map((x) => x.id);
      for (const id of ids.slice(0, 2)) {
        await request(app)
          .patch(`/api/work-items/${id}`)
          .set(auth(ctx.manager.token))
          .send({ expectedVersion: 1, status: "IN_PROGRESS" });
      }

      const byStatus = await request(app)
        .get(`/api/work-items?teamId=${ctx.teamId}&q=${prefix}&status=IN_PROGRESS`)
        .set(auth(ctx.member.token));
      expect(byStatus.body.total).toBe(2);

      const byPriority = await request(app)
        .get(`/api/work-items?teamId=${ctx.teamId}&q=${prefix}&priority=URGENT`)
        .set(auth(ctx.member.token));
      expect(byPriority.body.total).toBe(2);

      const page1 = await request(app)
        .get(`/api/work-items?teamId=${ctx.teamId}&q=${prefix}&page=1&pageSize=2`)
        .set(auth(ctx.member.token));
      expect(page1.body.items.length).toBe(2);
      expect(page1.body.total).toBe(5);
      expect(page1.body.totalPages).toBe(3);
      const page2 = await request(app)
        .get(`/api/work-items?teamId=${ctx.teamId}&q=${prefix}&page=2&pageSize=2`)
        .set(auth(ctx.member.token));
      expect(page2.body.items.length).toBe(2);
      const ids1 = page1.body.items.map((x: { id: string }) => x.id);
      const ids2 = page2.body.items.map((x: { id: string }) => x.id);
      expect(ids1.filter((x: string) => ids2.includes(x))).toEqual([]);

      // Oversized pages are rejected, not silently truncated in memory.
      const huge = await request(app)
        .get(`/api/work-items?teamId=${ctx.teamId}&pageSize=500`)
        .set(auth(ctx.member.token));
      expect(huge.status).toBe(400);

      // Unscoped listing only sees the caller's teams.
      const otherAdmin = await createUser(app, { prefix: "wiother" });
      await addMembership(otherAdmin.id, ctx.otherTeamId, "ADMIN");
      await createWorkItemViaApi(app, otherAdmin.token, ctx.otherTeamId);
      const scoped = await request(app)
        .get("/api/work-items?pageSize=100")
        .set(auth(ctx.member.token));
      const scopedTeamIds = new Set(
        (scoped.body.items as Array<{ teamId: string }>).map((x) => x.teamId),
      );
      expect(scopedTeamIds.has(ctx.otherTeamId)).toBe(false);
    } finally {
      await deleteTeamCascade(ctx.teamId);
      await deleteTeamCascade(ctx.otherTeamId);
    }
  });
});

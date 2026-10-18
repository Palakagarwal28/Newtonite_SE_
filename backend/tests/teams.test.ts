import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { addMembership, auth, createTeam, createUser, prisma } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("team access control", () => {
  it("lets a member read their own team but denies cross-team access by guessed id", async () => {
    const app = createApp();
    const member = await createUser(app, { prefix: "member" });
    const outsider = await createUser(app, { prefix: "outsider" });
    const teamA = await createTeam("TeamA");
    const teamB = await createTeam("TeamB");
    await addMembership(member.id, teamA.id, "MEMBER");

    const own = await request(app).get(`/api/teams/${teamA.id}`).set(auth(member.token));
    expect(own.status).toBe(200);
    expect(own.body.team.id).toBe(teamA.id);

    // Guessing teamB's id reveals nothing: 403, no team data.
    const guessed = await request(app).get(`/api/teams/${teamB.id}`).set(auth(member.token));
    expect(guessed.status).toBe(403);
    expect(guessed.body.error.code).toBe("TEAM_ACCESS_DENIED");
    expect(guessed.body.team).toBeUndefined();

    // Same for a user with no memberships at all.
    const noAccess = await request(app).get(`/api/teams/${teamA.id}`).set(auth(outsider.token));
    expect(noAccess.status).toBe(403);

    // And unauthenticated callers get 401, not data.
    const anon = await request(app).get(`/api/teams/${teamA.id}`);
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("lists only the caller's teams", async () => {
    const app = createApp();
    const member = await createUser(app, { prefix: "lister" });
    const team = await createTeam("ListTeam");
    await addMembership(member.id, team.id, "MEMBER");

    const res = await request(app).get("/api/teams").set(auth(member.token));
    expect(res.status).toBe(200);
    const ids = (res.body.teams as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(team.id);
  });

  it("returns 404 for a team that does not exist", async () => {
    const app = createApp();
    const member = await createUser(app, { prefix: "ghost" });
    const res = await request(app).get("/api/teams/team-that-does-not-exist").set(auth(member.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TEAM_NOT_FOUND");
  });
});

describe("role restrictions on membership management", () => {
  it("forbids MEMBER and MANAGER from adding members; allows team ADMIN", async () => {
    const app = createApp();
    const admin = await createUser(app, { prefix: "tadmin" });
    const manager = await createUser(app, { prefix: "tmgr" });
    const plain = await createUser(app, { prefix: "tplain" });
    const candidate = await createUser(app, { prefix: "tcand" });
    const candidate2 = await createUser(app, { prefix: "tcand2" });
    const candidate3 = await createUser(app, { prefix: "tcand3" });
    const team = await createTeam("RoleTeam");
    await addMembership(admin.id, team.id, "ADMIN");
    await addMembership(manager.id, team.id, "MANAGER");
    await addMembership(plain.id, team.id, "MEMBER");

    const byMember = await request(app)
      .post(`/api/teams/${team.id}/members`)
      .set(auth(plain.token))
      .send({ userId: candidate.id, role: "MEMBER" });
    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe("ROLE_REQUIRED");

    const byManager = await request(app)
      .post(`/api/teams/${team.id}/members`)
      .set(auth(manager.token))
      .send({ userId: candidate2.id, role: "MEMBER" });
    expect(byManager.status).toBe(403);
    expect(byManager.body.error.code).toBe("ROLE_REQUIRED");

    const byAdmin = await request(app)
      .post(`/api/teams/${team.id}/members`)
      .set(auth(admin.token))
      .send({ userId: candidate3.id, role: "MANAGER" });
    expect(byAdmin.status).toBe(201);
    expect(byAdmin.body.membership.role).toBe("MANAGER");
  });

  it("forbids removing members without ADMIN and protects the last ADMIN", async () => {
    const app = createApp();
    const admin = await createUser(app, { prefix: "radmin" });
    const plain = await createUser(app, { prefix: "rplain" });
    const team = await createTeam("RemoveTeam");
    await addMembership(admin.id, team.id, "ADMIN");
    await addMembership(plain.id, team.id, "MEMBER");

    const byMember = await request(app)
      .delete(`/api/teams/${team.id}/members/${admin.id}`)
      .set(auth(plain.token));
    expect(byMember.status).toBe(403);

    const lastAdmin = await request(app)
      .delete(`/api/teams/${team.id}/members/${admin.id}`)
      .set(auth(admin.token));
    expect(lastAdmin.status).toBe(409);
    expect(lastAdmin.body.error.code).toBe("CANNOT_REMOVE_LAST_ADMIN");
  });

  it("restricts team creation to global admins (team ADMIN is not enough)", async () => {
    const app = createApp();
    const globalAdmin = await createUser(app, { prefix: "gadmin", isGlobalAdmin: true });
    const teamAdmin = await createUser(app, { prefix: "nteamadmin" });
    const team = await createTeam("CreationScope");
    await addMembership(teamAdmin.id, team.id, "ADMIN");

    const denied = await request(app)
      .post("/api/teams")
      .set(auth(teamAdmin.token))
      .send({ name: `Nope-${Date.now()}` });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("ROLE_REQUIRED");

    const allowed = await request(app)
      .post("/api/teams")
      .set(auth(globalAdmin.token))
      .send({ name: `Created-${team.id.slice(-6)}` });
    expect(allowed.status).toBe(201);
  });

  it("lets a global admin read any team without membership", async () => {
    const app = createApp();
    const globalAdmin = await createUser(app, { prefix: "greader", isGlobalAdmin: true });
    const team = await createTeam("ForeignTeam");

    const res = await request(app).get(`/api/teams/${team.id}`).set(auth(globalAdmin.token));
    expect(res.status).toBe(200);
    expect(res.body.team.id).toBe(team.id);
  });
});

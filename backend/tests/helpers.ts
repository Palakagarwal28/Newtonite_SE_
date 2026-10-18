import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { hashPassword } from "../src/auth/password.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run integration tests (copy .env.example to .env)");
}

// Safety: never run destructive integration tests against a production-looking database.
if (/prod/i.test(process.env.DATABASE_URL) && process.env.ALLOW_DB_TESTS !== "true") {
  throw new Error("Refusing to run integration tests against a production-looking DATABASE_URL");
}

export const prisma = new PrismaClient();

/** Unique tag per test so parallel workers never collide on unique columns. */
export function tag(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export interface TestIdentity {
  id: string;
  email: string;
  name: string;
  password: string;
  token: string;
  isGlobalAdmin: boolean;
}

export async function createUser(
  app: Express,
  opts: { prefix: string; isGlobalAdmin?: boolean } = { prefix: "u" },
): Promise<TestIdentity> {
  const t = tag(opts.prefix);
  const email = `${t}@example.com`;
  const password = `Pw-${t}-12345!`;
  const name = `Test ${t}`;
  const created = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      isGlobalAdmin: opts.isGlobalAdmin ?? false,
    },
  });
  const login = await request(app).post("/api/auth/login").send({ email, password });
  if (login.status !== 200) throw new Error(`setup login failed: ${login.status}`);
  return {
    id: created.id,
    email,
    name,
    password,
    token: login.body.token as string,
    isGlobalAdmin: opts.isGlobalAdmin ?? false,
  };
}

export async function createTeam(name: string, description?: string) {
  return prisma.team.create({ data: { name: `${name}-${randomUUID().slice(0, 8)}`, description } });
}

export async function addMembership(userId: string, teamId: string, role: Role) {
  return prisma.membership.create({ data: { userId, teamId, role } });
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Create a work item through the real API (exercises auth + validation paths). */
export async function createWorkItemViaApi(
  app: Express,
  token: string,
  teamId: string,
  overrides: Record<string, unknown> = {},
) {
  const t = tag("wi");
  const res = await request(app)
    .post("/api/work-items")
    .set(auth(token))
    .send({ teamId, title: `Item ${t}`, description: `Description ${t}`, ...overrides });
  if (res.status !== 201) throw new Error(`setup work-item creation failed: ${res.status}`);
  return res.body.item as { id: string; version: number };
}

/**
 * Remove a team and everything created under it (items cascade to
 * comments/activity). Users are left in place — uniquely-named test rows.
 */
export async function deleteTeamCascade(teamId: string) {
  await prisma.workItem.deleteMany({ where: { teamId } });
  await prisma.membership.deleteMany({ where: { teamId } });
  await prisma.team.deleteMany({ where: { id: teamId } });
}

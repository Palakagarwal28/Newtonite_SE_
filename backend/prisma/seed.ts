/**
 * Reproducible local-demo bootstrap (dev/test only).
 *
 * Idempotent: safe to re-run; existing rows are updated, never duplicated.
 * Creates the minimum accounts/teams so login + team authorization can be
 * demonstrated without manual database work:
 *   - global admin (platform-level, NOT a team role)
 *   - two teams with MANAGER / MEMBER / outsider coverage
 *
 * Refuses to run in production unless ALLOW_SEED_PRODUCTION=true.
 * Passwords come from SEED_*_PASSWORD env vars or dev-only defaults below —
 * never commit real credentials; see .env.example.
 */
import "dotenv/config";
import { PrismaClient, type Role } from "@prisma/client";
import { hashPassword } from "../src/auth/password.js";

const prisma = new PrismaClient();

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

async function upsertUser(email: string, name: string, password: string, isGlobalAdmin: boolean) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, isGlobalAdmin },
    create: { email, name, passwordHash, isGlobalAdmin },
  });
}

async function ensureMembership(userId: string, teamId: string, role: Role) {
  await prisma.membership.upsert({
    where: { userId_teamId: { userId, teamId } },
    update: { role },
    create: { userId, teamId, role },
  });
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_PRODUCTION !== "true") {
    throw new Error("Seed refuses to run in production (set ALLOW_SEED_PRODUCTION=true to force)");
  }

  const admin = await upsertUser(
    env("SEED_ADMIN_EMAIL", "admin@example.com"),
    "Global Admin",
    env("SEED_ADMIN_PASSWORD", "Admin123!"),
    true,
  );
  const manager = await upsertUser(
    env("SEED_MANAGER_EMAIL", "manager.alpha@example.com"),
    "Alpha Manager",
    env("SEED_MANAGER_PASSWORD", "Manager123!"),
    false,
  );
  const member = await upsertUser(
    env("SEED_MEMBER_EMAIL", "member.alpha@example.com"),
    "Alpha Member",
    env("SEED_MEMBER_PASSWORD", "Member123!"),
    false,
  );
  // Authenticated but belongs to no team — used to demonstrate 403 cross-team denial.
  const outsider = await upsertUser(
    env("SEED_OUTSIDER_EMAIL", "outsider@example.com"),
    "Outsider",
    env("SEED_OUTSIDER_PASSWORD", "Outsider123!"),
    false,
  );

  const ops = await prisma.team.upsert({
    where: { name: "Ops Central" },
    update: {},
    create: { name: "Ops Central", description: "Seeded demo team" },
  });
  const payments = await prisma.team.upsert({
    where: { name: "Payments" },
    update: {},
    create: { name: "Payments", description: "Second seeded demo team" },
  });

  await ensureMembership(admin.id, ops.id, "ADMIN");
  await ensureMembership(manager.id, ops.id, "MANAGER");
  await ensureMembership(member.id, ops.id, "MEMBER");
  await ensureMembership(member.id, payments.id, "MEMBER");

  console.log("Seed complete (dev-only credentials):");
  console.log(`  admin    ${admin.email}  (global admin)`);
  console.log(`  manager  ${manager.email}  (MANAGER of Ops Central)`);
  console.log(`  member   ${member.email}  (MEMBER of Ops Central + Payments)`);
  console.log(`  outsider ${outsider.email}  (no team membership)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

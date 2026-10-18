import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma, tag } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/auth/register", () => {
  it("creates a regular user and never grants admin", async () => {
    const app = createApp();
    const t = tag("reg");
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: `${t}@example.com`, name: "Reg User", password: "Secret123!" });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(`${t}@example.com`);
    expect(res.body.user.isGlobalAdmin).toBe(false);
    expect(res.body.user).not.toHaveProperty("passwordHash");

    const row = await prisma.user.findUnique({ where: { email: `${t}@example.com` } });
    expect(row?.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash, not plaintext
    expect(row?.passwordHash).not.toContain("Secret123!");
  });

  it("rejects a smuggled isGlobalAdmin field instead of honouring it", async () => {
    const app = createApp();
    const t = tag("smuggle");
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email: `${t}@example.com`,
        name: "Sneaky",
        password: "Secret123!",
        isGlobalAdmin: true,
      });

    // strict() schema: unknown privilege field -> 400, nothing created
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.user.findUnique({ where: { email: `${t}@example.com` } })).toBeNull();
  });

  it("returns 409 for a duplicate email", async () => {
    const app = createApp();
    const t = tag("dup");
    await request(app)
      .post("/api/auth/register")
      .send({ email: `${t}@example.com`, name: "A", password: "Secret123!" });
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: `${t}@example.com`, name: "B", password: "Secret123!" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("validates body and returns the consistent error envelope", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", name: "", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toBeDefined();
  });
});

describe("POST /api/auth/login", () => {
  it("rejects unknown email and wrong password with the same code", async () => {
    const app = createApp();
    const t = tag("login");
    await request(app)
      .post("/api/auth/register")
      .send({ email: `${t}@example.com`, name: "L", password: "Correct123!" });

    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: `nobody-${t}@example.com`, password: "Correct123!" });
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: `${t}@example.com`, password: "Wrong12345!" });

    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns a usable Bearer token on success", async () => {
    const app = createApp();
    const t = tag("tok");
    await request(app)
      .post("/api/auth/register")
      .send({ email: `${t}@example.com`, name: "T", password: "Correct123!" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: `${t}@example.com`, password: "Correct123!" });

    expect(login.status).toBe(200);
    expect(typeof login.body.token).toBe("string");

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(`${t}@example.com`);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 for a forged/invalid token", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer forged.token.here");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("derives identity from the token, not from any client-supplied id", async () => {
    const app = createApp();
    const a = tag("identa");
    const b = tag("identb");
    await request(app)
      .post("/api/auth/register")
      .send({ email: `${a}@example.com`, name: "A", password: "Correct123!" });
    const regB = await request(app)
      .post("/api/auth/register")
      .send({ email: `${b}@example.com`, name: "B", password: "Correct123!" });
    const loginA = await request(app)
      .post("/api/auth/login")
      .send({ email: `${a}@example.com`, password: "Correct123!" });

    // No user-id parameter exists on /me; the token owner is always returned.
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginA.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(`${a}@example.com`);
    expect(me.body.user.id).not.toBe(regB.body.user.id);
  });
});

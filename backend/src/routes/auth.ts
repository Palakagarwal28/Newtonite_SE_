import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { getJwtExpiresIn, signAccessToken } from "../auth/tokens.js";
import { asyncHandler, HttpError, sendError } from "../lib/http-error.js";

const emailField = z.string().trim().toLowerCase().email().max(255);

// `.strict()` rejects unknown keys — notably `isGlobalAdmin`, so public
// registration can never self-grant administrator privileges.
const registerSchema = z
  .object({
    email: emailField,
    name: z.string().trim().min(1).max(100),
    password: z.string().min(8).max(128),
  })
  .strict();

const loginSchema = z
  .object({
    email: emailField,
    password: z.string().min(1).max(128),
  })
  .strict();

function toPublicUser(u: { id: string; email: string; name: string; isGlobalAdmin: boolean }) {
  return { id: u.id, email: u.email, name: u.name, isGlobalAdmin: u.isGlobalAdmin };
}

function validationError(e: z.ZodError, res: Response) {
  sendError(res, 400, "VALIDATION_ERROR", "Invalid request body", e.flatten().fieldErrors);
}

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const { email, name, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, "EMAIL_TAKEN", "Email already registered");
    }

    const passwordHash = await hashPassword(password);
    // isGlobalAdmin always false here by construction — no code path sets it from input.
    const user = await prisma.user.create({
      data: { email, name, passwordHash, isGlobalAdmin: false },
    });
    res.status(201).json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const { email, password } = parsed.data;

    // Same response for unknown email, missing hash, or wrong password:
    // avoids revealing which emails are registered.
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const token = signAccessToken({
      sub: user.id,
      email: user.email,
      isGlobalAdmin: user.isGlobalAdmin,
    });
    res.status(200).json({
      token,
      expiresIn: getJwtExpiresIn(),
      user: toPublicUser(user),
    });
  }),
);

// Identity comes from the verified token via requireAuth — there is no user-id parameter to spoof.
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const me = currentUser(req);
    const memberships = await prisma.membership.findMany({
      where: { userId: me.id },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.status(200).json({
      user: toPublicUser(me),
      memberships: memberships.map((m) => ({
        teamId: m.teamId,
        teamName: m.team.name,
        role: m.role,
      })),
    });
  }),
);

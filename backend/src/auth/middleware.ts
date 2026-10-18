import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { HttpError, sendError } from "../lib/http-error.js";
import { verifyAccessToken } from "./tokens.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isGlobalAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Derives identity ONLY from the verified Bearer token (JWT `sub`).
 * Fresh user row is loaded so revocation-by-delete and role changes take effect immediately.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      sendError(res, 401, "UNAUTHENTICATED", "Missing or malformed Authorization header");
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      sendError(res, 401, "UNAUTHENTICATED", "Missing or malformed Authorization header");
      return;
    }
    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch (err) {
      if (err instanceof HttpError) {
        sendError(res, err.status, err.code, err.message);
      } else {
        sendError(res, 401, "INVALID_TOKEN", "Invalid or expired token");
      }
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user) {
      sendError(res, 401, "INVALID_TOKEN", "Account no longer exists");
      return;
    }
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      isGlobalAdmin: user.isGlobalAdmin,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Use inside handlers after requireAuth — fails closed if middleware was skipped. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new Error("requireAuth middleware missing");
  return req.user;
}

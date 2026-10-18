import jwt, { type SignOptions } from "jsonwebtoken";
import { HttpError } from "../lib/http-error.js";

export interface AccessTokenClaims {
  /** User id (JWT `sub`). The ONLY identity source — never trust a client-supplied user id. */
  sub: string;
  email: string;
  isGlobalAdmin: boolean;
}

const TEST_ONLY_SECRET = "test-only-insecure-jwt-secret-change-me-32b";

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production");
  }
  console.warn("[auth] JWT_SECRET not set — using insecure test-only secret (dev/test only)");
  return TEST_ONLY_SECRET;
}

export function getJwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? "12h";
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const options: SignOptions = {
    subject: claims.sub,
    expiresIn: getJwtExpiresIn() as SignOptions["expiresIn"],
  };
  return jwt.sign(
    { email: claims.email, isGlobalAdmin: claims.isGlobalAdmin },
    getJwtSecret(),
    options,
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  let payload: unknown;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch {
    throw new HttpError(401, "INVALID_TOKEN", "Invalid or expired token");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new HttpError(401, "INVALID_TOKEN", "Invalid or expired token");
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.sub !== "string" || p.sub.length === 0 || typeof p.email !== "string") {
    throw new HttpError(401, "INVALID_TOKEN", "Invalid or expired token");
  }
  return { sub: p.sub, email: p.email, isGlobalAdmin: p.isGlobalAdmin === true };
}

import bcrypt from "bcryptjs";

const ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 10);

/** bcrypt hash. Passwords are never stored or logged in plaintext. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

/** Constant-time comparison (bcrypt built-in). Returns false — never throws — on mismatch. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

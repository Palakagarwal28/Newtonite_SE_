import type { NextFunction, Request, Response } from "express";

/** Carries an explicit HTTP status + machine-readable code to the central handler. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  if (details !== undefined) {
    res.status(status).json({ error: { code, message, details } });
  } else {
    res.status(status).json({ error: { code, message } });
  }
}

/** Express 4 does not forward async rejections — wrap every async route handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

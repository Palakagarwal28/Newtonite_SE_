import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { teamsRouter } from "./routes/teams.js";
import { workItemsRouter } from "./routes/work-items.js";
import { HttpError } from "./lib/http-error.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/teams", teamsRouter);
  app.use("/api/work-items", workItemsRouter);

  // 404 for unknown API routes (keeps frontend routing separate).
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  // Central error serializer. HttpError carries explicit status/code; everything
  // else becomes 500 without leaking internals. Never leak stack traces to clients.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      if (err.details !== undefined) {
        res
          .status(err.status)
          .json({ error: { code: err.code, message: err.message, details: err.details } });
      } else {
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
      }
      return;
    }
    // Malformed JSON bodies (body-parser SyntaxError).
    if (
      err instanceof SyntaxError &&
      typeof (err as { status?: unknown }).status === "number" &&
      "body" in err
    ) {
      res.status(400).json({ error: { code: "INVALID_JSON", message: "Malformed JSON body" } });
      return;
    }
    console.error(err);
    res
      .status(500)
      .json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  return app;
}

import { Router, type Request, type Response } from "express";
import { currentUser, requireAuth } from "../auth/middleware.js";
import { asyncHandler, sendError } from "../lib/http-error.js";
import {
  activityQuerySchema,
  commentSchema,
  createWorkItemSchema,
  listWorkItemsQuerySchema,
  updateWorkItemSchema,
} from "../work-items/schemas.js";
import {
  addComment,
  createWorkItem,
  getWorkItem,
  listActivity,
  listWorkItems,
  updateWorkItem,
} from "../work-items/service.js";

function validationError(e: { flatten: () => { fieldErrors: unknown } }, res: Response) {
  sendError(res, 400, "VALIDATION_ERROR", "Invalid request", e.flatten().fieldErrors);
}

export const workItemsRouter = Router();

// Every work-item operation requires authentication; team/role checks live in the service.
workItemsRouter.use(requireAuth);

workItemsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createWorkItemSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const item = await createWorkItem(currentUser(req), parsed.data);
    res.status(201).json({ item });
  }),
);

workItemsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = listWorkItemsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const result = await listWorkItems(currentUser(req), parsed.data);
    res.status(200).json(result);
  }),
);

workItemsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await getWorkItem(currentUser(req), req.params.id);
    res.status(200).json(result);
  }),
);

workItemsRouter.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateWorkItemSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const item = await updateWorkItem(currentUser(req), req.params.id, parsed.data);
    res.status(200).json({ item });
  }),
);

workItemsRouter.post(
  "/:id/comments",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const comment = await addComment(currentUser(req), req.params.id, parsed.data.body);
    res.status(201).json({ comment });
  }),
);

workItemsRouter.get(
  "/:id/activity",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = activityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      validationError(parsed.error, res);
      return;
    }
    const result = await listActivity(
      currentUser(req),
      req.params.id,
      parsed.data.page,
      parsed.data.pageSize,
    );
    res.status(200).json(result);
  }),
);

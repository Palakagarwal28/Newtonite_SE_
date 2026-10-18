import { z } from "zod";

const priorities = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const statuses = z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CLOSED"]);

/** Items are always born OPEN — no status field, so callers cannot skip the workflow. */
export const createWorkItemSchema = z
  .object({
    teamId: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(20000),
    priority: priorities.optional().default("MEDIUM"),
    assigneeId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

export const listWorkItemsQuerySchema = z.object({
  teamId: z.string().trim().min(1).max(64).optional(),
  status: statuses.optional(),
  priority: priorities.optional(),
  assigneeId: z.string().trim().min(1).max(64).optional(),
  // mine=true scopes to items assigned to the caller.
  mine: z.coerce.boolean().optional(),
  // Case-insensitive substring match on title + description (database-side).
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const mutableFields = {
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(20000).optional(),
  priority: priorities.optional(),
  status: statuses.optional(),
  // string = assign, null = unassign, absent = leave unchanged.
  assigneeId: z.string().trim().min(1).max(64).nullable().optional(),
};

/** expectedVersion is mandatory: stale writes must fail loudly, never silently. */
export const updateWorkItemSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    ...mutableFields,
  })
  .strict()
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.priority !== undefined ||
      v.status !== undefined ||
      v.assigneeId !== undefined,
    { message: "At least one field to update is required alongside expectedVersion" },
  );

export const commentSchema = z
  .object({
    body: z.string().trim().min(1).max(5000),
  })
  .strict();

export const activityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;
export type ListWorkItemsQuery = z.infer<typeof listWorkItemsQuerySchema>;

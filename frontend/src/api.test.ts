import { describe, expect, it } from "vitest";
import {
  ApiError,
  apiListWorkItems,
  apiUpdateWorkItem,
  friendlyMessage,
} from "./api.ts";
import { createFetchMock, stopFetchMock } from "./test-utils.tsx";

/**
 * Contract tests: the client's URLs, methods, and bodies must match the real
 * backend routes (backend/src/routes/*.ts). Backend behavior itself is covered
 * by backend/tests/*.test.ts against real Postgres.
 */
describe("api client contracts", () => {
  it("builds the list query with the exact backend parameter names", async () => {
    const { calls } = createFetchMock((url) => {
      if (url.startsWith("/api/work-items")) {
        return { status: 200, body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } };
      }
      return undefined;
    });
    try {
      await apiListWorkItems("tok", {
        teamId: "t1",
        status: "OPEN",
        priority: "URGENT",
        mine: true,
        q: "payout",
        page: 2,
        pageSize: 20,
      });
      const url = calls[0].url;
      expect(url).toContain("/api/work-items?");
      for (const part of [
        "teamId=t1",
        "status=OPEN",
        "priority=URGENT",
        "mine=true",
        "q=payout",
        "page=2",
        "pageSize=20",
      ]) {
        expect(url).toContain(part);
      }
      expect(calls[0].init?.headers).toMatchObject({ Authorization: "Bearer tok" });
    } finally {
      stopFetchMock();
    }
  });

  it("sends expectedVersion on PATCH and parses 409 envelopes", async () => {
    const { calls } = createFetchMock(() => ({
      status: 409,
      body: { error: { code: "VERSION_CONFLICT", message: "stale" } },
    }));
    try {
      const err = await apiUpdateWorkItem("tok", "id1", {
        expectedVersion: 3,
        title: "New",
      }).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).code).toBe("VERSION_CONFLICT");
      expect(JSON.parse(calls[0].init?.body as string)).toEqual({
        expectedVersion: 3,
        title: "New",
      });
      expect(calls[0].init?.method).toBe("PATCH");
    } finally {
      stopFetchMock();
    }
  });

  it("maps backend codes to friendly messages", () => {
    expect(friendlyMessage(new ApiError(401, "INVALID_CREDENTIALS", "x"))).toContain(
      "Invalid email",
    );
    expect(
      friendlyMessage(new ApiError(422, "INVALID_STATUS_TRANSITION", "x", { allowed: ["DONE"] })),
    ).toContain("DONE");
    expect(friendlyMessage(new ApiError(0, "NETWORK_ERROR", "down"))).toContain("down");
  });
});

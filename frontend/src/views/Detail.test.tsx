import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DetailView from "./Detail.tsx";
import { createFetchMock, fakeMe, stopFetchMock } from "../test-utils.tsx";
import type { MeResponse } from "../api.ts";

const { authState } = vi.hoisted(() => ({
  authState: {
    token: "test-token",
    me: {
      user: { id: "u1", email: "a@example.com", name: "A", isGlobalAdmin: false },
      memberships: [{ teamId: "t1", teamName: "Ops", role: "MEMBER" }],
    } as MeResponse,
    loading: false,
    error: null as string | null,
    login: async () => {},
    logout: () => {},
    reload: async () => {},
    requireToken: () => "test-token",
  },
}));

vi.mock("../auth.tsx", () => ({
  useAuth: () => authState,
}));

const DETAIL = {
  id: "w1",
  title: "Original title",
  description: "Original desc",
  status: "OPEN",
  priority: "MEDIUM",
  version: 2,
  teamId: "t1",
  team: { id: "t1", name: "Ops" },
  assigneeId: null,
  assignee: null,
  createdById: "u1",
  createdBy: { id: "u1", email: "a@example.com", name: "A" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  recentComments: [],
  commentCount: 0,
  activityCount: 1,
};

function baseHandler(patch: (body: Record<string, unknown>) => { status: number; body: unknown }) {
  return (url: string, init?: RequestInit) => {
    if (url === "/api/work-items/w1" && (!init?.method || init.method === "GET")) {
      return { status: 200, body: DETAIL };
    }
    if (url.startsWith("/api/work-items/w1/activity")) {
      if (url.includes("page=2")) {
        return {
          status: 200,
          body: {
            events: [
              {
                id: "e2",
                action: "PRIORITY_CHANGED",
                actorId: "u1",
                actor: { id: "u1", email: "a", name: "A" },
                detail: { priority: { before: "LOW", after: "MEDIUM" } },
                version: 2,
                createdAt: "2026-01-02T00:00:00.000Z",
              },
            ],
            page: 2,
            pageSize: 10,
            total: 2,
            totalPages: 2,
          },
        };
      }
      return {
        status: 200,
        body: {
          events: [
            {
              id: "e1",
              action: "CREATED",
              actorId: "u1",
              actor: { id: "u1", email: "a", name: "A" },
              detail: null,
              version: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          page: 1,
          pageSize: 10,
          total: 2,
          totalPages: 2,
        },
      };
    }
    if (url === "/api/teams/t1/members") {
      return {
        status: 200,
        body: { members: [{ userId: "u1", email: "a@example.com", name: "A", role: "MEMBER" }] },
      };
    }
    if (url === "/api/work-items/w1" && init?.method === "PATCH") {
      return patch(JSON.parse(init.body as string));
    }
    if (url === "/api/work-items/w1/comments") {
      return {
        status: 201,
        body: {
          comment: {
            id: "c1",
            body: "A helpful note",
            authorId: "u1",
            author: { id: "u1", email: "a@example.com", name: "Alice" },
            createdAt: "2026-01-03T00:00:00.000Z",
          },
        },
      };
    }
    return undefined;
  };
}

describe("DetailView", () => {
  it("hides status/assignment controls for MEMBER (server still enforces)", async () => {
    authState.me = fakeMe(); // MEMBER of t1
    const { calls } = createFetchMock(
      baseHandler(() => ({ status: 200, body: { item: DETAIL } })),
    );
    try {
      render(<DetailView id="w1" onBack={() => {}} />);
      await waitFor(() => expect(screen.getByText("Original title", { exact: false })).toBeInTheDocument());
      expect(screen.getByText(/requires MANAGER or ADMIN/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Status \(legal/)).toBeNull();

      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Member edit" } });
      fireEvent.click(screen.getByText(/Save \(version 2\)/));
      await waitFor(() =>
        expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true),
      );
      const patch = calls.find((c) => c.init?.method === "PATCH");
      const body = JSON.parse(patch!.init!.body as string);
      expect(body).toEqual({ expectedVersion: 2, title: "Member edit" });
      expect(body).not.toHaveProperty("status");
    } finally {
      stopFetchMock();
    }
  });

  it("offers only legal transitions, keeping DONE and CLOSED distinct", async () => {
    authState.me = fakeMe({
      memberships: [{ teamId: "t1", teamName: "Ops", role: "MANAGER" }],
    });
    createFetchMock(baseHandler(() => ({ status: 200, body: { item: DETAIL } })));
    try {
      render(<DetailView id="w1" onBack={() => {}} />);
      await waitFor(() => expect(screen.getByLabelText(/Status \(legal/)).toBeInTheDocument());
      const select = screen.getByLabelText(/Status \(legal/) as HTMLSelectElement;
      const options = within(select).getAllByRole("option").map((o) => o.textContent);
      expect(options).toEqual(["OPEN", "IN_PROGRESS", "CLOSED"]);
      expect(options).not.toContain("DONE");
    } finally {
      stopFetchMock();
    }
  });

  it("recovers from 409 without losing the draft and never auto-retries", async () => {
    authState.me = fakeMe({
      memberships: [{ teamId: "t1", teamName: "Ops", role: "MANAGER" }],
    });
    const { calls } = createFetchMock(
      baseHandler(() => ({
        status: 409,
        body: { error: { code: "VERSION_CONFLICT", message: "stale" } },
      })),
    );
    try {
      render(<DetailView id="w1" onBack={() => {}} />);
      await waitFor(() => expect(screen.getByLabelText("Title")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My conflicted edit" } });
      fireEvent.click(screen.getByText(/Save \(version 2\)/));

      await waitFor(() => expect(screen.getAllByText(/changed elsewhere/).length).toBeGreaterThanOrEqual(1));
      // Draft preserved in the form…
      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("My conflicted edit");
      // …exactly one PATCH was sent (no silent retry with a newer version)…
      expect(calls.filter((c) => c.init?.method === "PATCH")).toHaveLength(1);
      // …and a refresh path is offered.
      expect(screen.getByText(/Reload latest/)).toBeInTheDocument();
    } finally {
      stopFetchMock();
    }
  });

  it("discards changes after a 409 conflict when user chooses Discard", async () => {
    authState.me = fakeMe({
      memberships: [{ teamId: "t1", teamName: "Ops", role: "MANAGER" }],
    });
    createFetchMock(
      baseHandler(() => ({
        status: 409,
        body: { error: { code: "VERSION_CONFLICT", message: "stale" } },
      })),
    );
    try {
      render(<DetailView id="w1" onBack={() => {}} />);
      await waitFor(() => expect(screen.getByLabelText("Title")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft to discard" } });
      fireEvent.click(screen.getByText(/Save \(version 2\)/));

      await waitFor(() => expect(screen.getByText("Discard my changes")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Discard my changes"));

      expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Original title");
      expect(screen.queryByText(/Conflict: changed elsewhere/)).toBeNull();
    } finally {
      stopFetchMock();
    }
  });

  it("blocks empty titles client-side without a request", async () => {
    authState.me = fakeMe();
    const { calls } = createFetchMock(
      baseHandler(() => ({ status: 200, body: { item: DETAIL } })),
    );
    try {
      render(<DetailView id="w1" onBack={() => {}} />);
      await waitFor(() => expect(screen.getByLabelText("Title")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
      fireEvent.click(screen.getByText(/Save \(version 2\)/));
      await waitFor(() => expect(screen.getByText("Title and description cannot be empty.")).toBeInTheDocument());
      expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);
    } finally {
      stopFetchMock();
    }
  });

  it("posts a comment and prevents duplicate clicks while pending", async () => {
    authState.me = fakeMe();
    const { calls } = createFetchMock(
      baseHandler(() => ({ status: 200, body: { item: DETAIL } })),
    );
    try {
      render(<DetailView id="w1" onBack={() => {}} />);
      await waitFor(() => expect(screen.getByLabelText("Add a comment")).toBeInTheDocument());

      const textarea = screen.getByLabelText("Add a comment");
      fireEvent.change(textarea, { target: { value: "A helpful note" } });

      const postBtn = screen.getByText("Post comment");
      fireEvent.click(postBtn);

      await waitFor(() =>
        expect(calls.some((c) => c.url.endsWith("/comments") && c.init?.method === "POST")).toBe(true),
      );
      const commentCall = calls.find((c) => c.url.endsWith("/comments"));
      expect(JSON.parse(commentCall!.init!.body as string)).toEqual({ body: "A helpful note" });
    } finally {
      stopFetchMock();
    }
  });

  it("loads more activity events on clicking load more", async () => {
    authState.me = fakeMe();
    const { calls } = createFetchMock(
      baseHandler(() => ({ status: 200, body: { item: DETAIL } })),
    );
    try {
      render(<DetailView id="w1" onBack={() => {}} />);
      await waitFor(() => expect(screen.getByText(/Load more/)).toBeInTheDocument());

      fireEvent.click(screen.getByText(/Load more/));
      await waitFor(() =>
        expect(calls.some((c) => c.url.includes("page=2"))).toBe(true),
      );
      await waitFor(() => expect(screen.getByText("PRIORITY_CHANGED")).toBeInTheDocument());
    } finally {
      stopFetchMock();
    }
  });
});

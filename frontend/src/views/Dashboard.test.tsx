import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DashboardView from "./Dashboard.tsx";
import { createFetchMock, stopFetchMock } from "../test-utils.tsx";

const { fakeAuthValue } = vi.hoisted(() => ({
  fakeAuthValue: {
    token: "test-token",
    me: {
      user: { id: "u1", email: "a@example.com", name: "A", isGlobalAdmin: false },
      memberships: [{ teamId: "t1", teamName: "Ops", role: "MEMBER" }],
    },
    loading: false,
    error: null,
    login: () => Promise.resolve(),
    logout: () => {},
    reload: () => Promise.resolve(),
    requireToken: () => "test-token",
  },
}));

vi.mock("../auth.tsx", () => ({
  useAuth: () => fakeAuthValue,
}));

const ITEM = {
  id: "item-1",
  title: "Investigate payout",
  description: "d",
  status: "OPEN",
  priority: "HIGH",
  version: 1,
  teamId: "t1",
  team: { id: "t1", name: "Ops" },
  assigneeId: null,
  assignee: null,
  createdById: "u1",
  createdBy: { id: "u1", email: "a@example.com", name: "A" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function handler() {
  return (url: string, init?: RequestInit) => {
    if (url === "/api/teams") {
      return { status: 200, body: { teams: [{ id: "t1", name: "Ops", description: null, role: "MEMBER" }] } };
    }
    if (url.startsWith("/api/teams/")) {
      return { status: 200, body: { members: [{ userId: "u1", email: "a@example.com", name: "A", role: "MEMBER" }] } };
    }
    if (url === "/api/work-items" && init?.method === "POST") {
      return { status: 201, body: { item: { ...ITEM, id: "item-2", title: "New Item" } } };
    }
    if (url.startsWith("/api/work-items")) {
      if (url.includes("pageSize=1")) {
        return { status: 200, body: { items: [], page: 1, pageSize: 1, total: 4, totalPages: 4 } };
      }
      return {
        status: 200,
        body: { items: [ITEM], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      };
    }
    return undefined;
  };
}

describe("DashboardView", () => {
  it("loads and displays work items with metrics", async () => {
    createFetchMock(handler());
    try {
      render(<DashboardView onOpen={() => {}} />);
      expect(screen.getByLabelText("Loading work items")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText("Investigate payout")).toBeInTheDocument());
      const table = screen.getByLabelText("Work items");
      expect(within(table).getByText("OPEN")).toBeInTheDocument();
      expect(screen.getByLabelText("Summary metrics")).toBeInTheDocument();
    } finally {
      stopFetchMock();
    }
  });

  it("sends the status filter server-side and paginates server-side", async () => {
    const { calls } = createFetchMock(handler());
    try {
      render(<DashboardView onOpen={() => {}} />);
      await waitFor(() => expect(screen.getByText("Investigate payout")).toBeInTheDocument());

      const statusSelect = screen.getByLabelText("Status");
      fireEvent.change(statusSelect, { target: { value: "IN_PROGRESS" } });
      await waitFor(() =>
        expect(calls.some((c) => c.url.includes("status=IN_PROGRESS"))).toBe(true),
      );

      const next = screen.getByText("Next");
      expect(next).toBeDisabled(); // totalPages=1 in mock
    } finally {
      stopFetchMock();
    }
  });

  it("updates filters when clicking interactive metric cards", async () => {
    const { calls } = createFetchMock(handler());
    try {
      render(<DashboardView onOpen={() => {}} />);
      await waitFor(() => expect(screen.getByText("Investigate payout")).toBeInTheDocument());

      const assignedToMeCard = screen.getByTitle("Filter by Assigned to me");
      fireEvent.click(assignedToMeCard);

      await waitFor(() =>
        expect(calls.some((c) => c.url.includes("mine=true"))).toBe(true),
      );
    } finally {
      stopFetchMock();
    }
  });

  it("clears filters when clicking the clear filters button", async () => {
    const { calls } = createFetchMock(handler());
    try {
      render(<DashboardView onOpen={() => {}} />);
      await waitFor(() => expect(screen.getByText("Investigate payout")).toBeInTheDocument());

      const statusSelect = screen.getByLabelText("Status");
      fireEvent.change(statusSelect, { target: { value: "IN_PROGRESS" } });
      await waitFor(() => expect(screen.getByTitle("Reset all filters")).toBeInTheDocument());

      fireEvent.click(screen.getByTitle("Reset all filters"));
      await waitFor(() => {
        const lastCall = calls[calls.length - 1];
        expect(lastCall.url).not.toContain("status=IN_PROGRESS");
      });
    } finally {
      stopFetchMock();
    }
  });

  it("shows empty and error states with retry", async () => {
    let failList = true;
    const { calls } = createFetchMock((url: string) => {
      if (url === "/api/teams") {
        return { status: 200, body: { teams: [] } };
      }
      if (url.startsWith("/api/work-items")) {
        if (failList && !url.includes("pageSize=1")) {
          return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "boom" } } };
        }
        return { status: 200, body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } };
      }
      return undefined;
    });
    try {
      render(<DashboardView onOpen={() => {}} />);
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      failList = false;
      fireEvent.click(screen.getByText("Retry"));
      await waitFor(() =>
        expect(screen.getByText("No work items match these filters.")).toBeInTheDocument(),
      );
      expect(calls.length).toBeGreaterThan(1);
    } finally {
      stopFetchMock();
    }
  });

  it("opens the detail view on row click", async () => {
    const onOpen = vi.fn();
    createFetchMock(handler());
    try {
      render(<DashboardView onOpen={onOpen} />);
      await waitFor(() => expect(screen.getByText("Investigate payout")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Investigate payout"));
      expect(onOpen).toHaveBeenCalledWith("item-1");
    } finally {
      stopFetchMock();
    }
  });

  it("opens the create dialog and submits a new work item", async () => {
    const onOpen = vi.fn();
    createFetchMock(handler());
    try {
      render(<DashboardView onOpen={onOpen} />);
      await waitFor(() => expect(screen.getByText("New work item")).toBeInTheDocument());

      fireEvent.click(screen.getByText("New work item"));
      await waitFor(() => expect(screen.getByRole("dialog", { name: "Create work item" })).toBeInTheDocument());

      const dialog = screen.getByRole("dialog", { name: "Create work item" });
      fireEvent.change(within(dialog).getByPlaceholderText(/Resolve payment/i), { target: { value: "New Item Title" } });
      fireEvent.change(within(dialog).getByPlaceholderText(/Provide context/i), { target: { value: "New Description" } });

      fireEvent.click(within(dialog).getByText("Create"));
      await waitFor(() => expect(onOpen).toHaveBeenCalledWith("item-2"));
    } finally {
      stopFetchMock();
    }
  });
});

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App.tsx";
import { createFetchMock, fakeMe, stopFetchMock } from "./test-utils.tsx";

function mockFetch(meStatus: number) {
  return createFetchMock((url: string) => {
    if (url === "/api/health") {
      return { status: 200, body: { status: "ok", service: "newtonite-backend", time: "t" } };
    }
    if (url === "/api/auth/me") {
      return meStatus === 200
        ? { status: 200, body: fakeMe({ memberships: [{ teamId: "t1", teamName: "Ops Central", role: "MANAGER" }] }) }
        : { status: 401, body: { error: { code: "INVALID_TOKEN", message: "expired" } } };
    }
    if (url === "/api/teams") {
      return { status: 200, body: { teams: [{ id: "t1", name: "Ops Central", description: "Ops", role: "MANAGER" }] } };
    }
    if (url.startsWith("/api/teams/t1/members")) {
      return { status: 200, body: { members: [] } };
    }
    if (url.startsWith("/api/work-items")) {
      return { status: 200, body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } };
    }
    return undefined;
  });
}

describe("App shell", () => {
  it("shows the login view without a session", async () => {
    localStorage.clear();
    mockFetch(200);
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByLabelText("Login")).toBeInTheDocument());
      expect(screen.getByText("Newtonite Ops")).toBeInTheDocument();
    } finally {
      stopFetchMock();
    }
  });

  it("falls back to login on an expired token", async () => {
    localStorage.clear();
    localStorage.setItem("newtonite.token", "expired");
    mockFetch(401);
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByLabelText("Login")).toBeInTheDocument());
      expect(localStorage.getItem("newtonite.token")).toBeNull();
    } finally {
      stopFetchMock();
      localStorage.clear();
    }
  });

  it("loads the dashboard with a valid session", async () => {
    localStorage.clear();
    localStorage.setItem("newtonite.token", "valid");
    mockFetch(200);
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByText("New work item")).toBeInTheDocument());
      expect(screen.getByText("Log out")).toBeInTheDocument();
      expect(screen.getByLabelText("Application navigation")).toBeInTheDocument();
    } finally {
      stopFetchMock();
      localStorage.clear();
    }
  });

  it("supports collapsing and expanding the sidebar on desktop", async () => {
    localStorage.clear();
    localStorage.setItem("newtonite.token", "valid");
    mockFetch(200);
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByLabelText("Application navigation")).toBeInTheDocument());
      const sidebar = screen.getByLabelText("Application navigation");
      expect(sidebar).not.toHaveClass("collapsed");

      const toggleBtn = screen.getByTitle("Collapse sidebar");
      fireEvent.click(toggleBtn);
      expect(sidebar).toHaveClass("collapsed");

      const expandBtn = screen.getByTitle("Expand sidebar");
      fireEvent.click(expandBtn);
      expect(sidebar).not.toHaveClass("collapsed");
    } finally {
      stopFetchMock();
      localStorage.clear();
    }
  });

  it("supports opening and closing mobile navigation drawer", async () => {
    localStorage.clear();
    localStorage.setItem("newtonite.token", "valid");
    mockFetch(200);
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByLabelText("Application navigation")).toBeInTheDocument());
      const sidebar = screen.getByLabelText("Application navigation");
      expect(sidebar).not.toHaveClass("mobile-open");

      const mobileMenuBtn = screen.getByLabelText("Toggle navigation");
      fireEvent.click(mobileMenuBtn);
      expect(sidebar).toHaveClass("mobile-open");

      const closeBtn = screen.getByLabelText("Close navigation");
      fireEvent.click(closeBtn);
      expect(sidebar).not.toHaveClass("mobile-open");
    } finally {
      stopFetchMock();
      localStorage.clear();
    }
  });

  it("supports switching workspace team context from the sidebar", async () => {
    localStorage.clear();
    localStorage.setItem("newtonite.token", "valid");
    const { calls } = mockFetch(200);
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByLabelText("Select team context")).toBeInTheDocument());

      const teamContextBtn = screen.getByLabelText("Select team context");
      fireEvent.click(teamContextBtn);

      const teamOption = await screen.findByRole("menuitem", { name: /Ops Central/ });
      fireEvent.click(teamOption);

      await waitFor(() =>
        expect(calls.some((c) => c.url.includes("teamId=t1"))).toBe(true),
      );
    } finally {
      stopFetchMock();
      localStorage.clear();
    }
  });
});

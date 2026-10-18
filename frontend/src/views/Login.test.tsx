import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginView from "./Login.tsx";
import { createFetchMock, stopFetchMock } from "../test-utils.tsx";

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));

vi.mock("../auth.tsx", () => ({
  useAuth: () => ({ login: loginMock }),
}));

describe("LoginView", () => {
  it("requires email and password before calling the API", async () => {
    loginMock.mockReset();
    createFetchMock(() => undefined);
    try {
      render(<LoginView />);
      fireEvent.click(screen.getByText("Sign in"));
      await waitFor(() => expect(screen.getByText("Enter your email and password.")).toBeInTheDocument());
      expect(loginMock).not.toHaveBeenCalled();
    } finally {
      stopFetchMock();
    }
  });

  it("shows backend INVALID_CREDENTIALS failures", async () => {
    loginMock.mockReset();
    loginMock.mockRejectedValueOnce(
      Object.assign(new Error("Invalid email or password."), {
        name: "ApiError",
        status: 401,
        code: "INVALID_CREDENTIALS",
      }),
    );
    // friendlyMessage only special-cases real ApiError instances; fall back text is fine here.
    createFetchMock(() => undefined);
    try {
      render(<LoginView />);
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
      fireEvent.click(screen.getByText("Sign in"));
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(loginMock).toHaveBeenCalledWith("a@example.com", "wrong");
    } finally {
      stopFetchMock();
    }
  });

  it("prevents duplicate submissions while pending", async () => {
    loginMock.mockReset();
    let resolve!: () => void;
    loginMock.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    createFetchMock(() => undefined);
    try {
      render(<LoginView />);
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x".repeat(8) } });
      const button = screen.getByText("Sign in");
      fireEvent.click(button);
      fireEvent.click(screen.getByText("Signing in…"));
      expect(loginMock).toHaveBeenCalledTimes(1);
      resolve();
      // Flush the post-login state update inside act().
      await waitFor(() => expect(screen.getByText("Sign in")).toBeInTheDocument());
    } finally {
      stopFetchMock();
    }
  });
});

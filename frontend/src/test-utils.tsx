import { vi } from "vitest";
import type { MeResponse } from "./api.ts";

/** Route fetch by matching URL prefixes; records every call for assertions. */
export function createFetchMock(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const hit = handler(url, init);
    if (!hit) {
      return { ok: false, status: 404, json: async () => ({ error: { code: "NOT_FOUND", message: "Not found" } }) };
    }
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      json: async () => hit.body,
    };
  });
  vi.stubGlobal("fetch", fn);
  return { fetchMock: fn, calls };
}

export function stopFetchMock() {
  vi.unstubAllGlobals();
}

export function fakeMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: { id: "u1", email: "a@example.com", name: "A", isGlobalAdmin: false },
    memberships: [{ teamId: "t1", teamName: "Ops", role: "MEMBER" }],
    ...overrides,
  };
}

/** Minimal auth mock shape matching AuthProvider's useAuth return. */
export function fakeAuth(me: MeResponse | null, extra: Record<string, unknown> = {}) {
  return {
    token: me ? "test-token" : null,
    me,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    reload: vi.fn(),
    requireToken: vi.fn(() => (me ? "test-token" : null)),
    ...extra,
  };
}

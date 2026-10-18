import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, apiLogin, apiMe, type MeResponse } from "./api.ts";

const TOKEN_KEY = "newtonite.token";

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

interface AuthState {
  token: string | null;
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Force a session reload (e.g. after a 401 elsewhere). */
  reload: () => Promise<void>;
  /** Returns false when there is no usable session (callers redirect to login). */
  requireToken: () => string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(token !== null);
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage unavailable — session simply won't persist.
    }
    setToken(null);
    setMe(null);
    setError(null);
  }, []);

  const load = useCallback(
    async (t: string) => {
      try {
        const data = await apiMe(t);
        setMe(data);
        setError(null);
      } catch (e) {
        // Expired/invalid token (or deleted account): drop the session so the
        // login view is shown instead of failing every request.
        if (e instanceof ApiError && (e.status === 401 || e.code === "INVALID_TOKEN")) {
          logout();
        } else {
          setError(e instanceof Error ? e.message : "Failed to load session.");
        }
      } finally {
        setLoading(false);
      }
    },
    [logout],
  );

  useEffect(() => {
    if (token) {
      setLoading(true);
      void load(token);
    } else {
      setLoading(false);
    }
  }, [token, load]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiLogin(email, password);
      try {
        localStorage.setItem(TOKEN_KEY, res.token);
      } catch {
        // Private-mode storage — session lasts for this tab only.
      }
      setToken(res.token);
      setLoading(true);
      await load(res.token);
    },
    [load],
  );

  const reload = useCallback(async () => {
    if (token) {
      setLoading(true);
      await load(token);
    }
  }, [token, load]);

  const requireToken = useCallback(() => token, [token]);

  const value = useMemo<AuthState>(
    () => ({ token, me, loading, error, login, logout, reload, requireToken }),
    [token, me, loading, error, login, logout, reload, requireToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

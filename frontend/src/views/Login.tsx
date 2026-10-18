import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../auth.tsx";
import { friendlyMessage } from "../api.ts";
import { AlertCircleIcon, ShieldIcon, UserIcon } from "../components/Icons.tsx";

const DEMO_ACCOUNTS = [
  { label: "Global Admin", email: "admin@example.com", pass: "Admin123!", role: "Global Admin" },
  { label: "Manager", email: "manager.alpha@example.com", pass: "Manager123!", role: "Ops Central Manager" },
  { label: "Member", email: "member.alpha@example.com", pass: "Member123!", role: "Ops Central Member" },
];

export default function LoginView() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (pending) return; // prevent duplicate submissions
    setPending(true);
    setError(null);
    try {
      await login(cleanEmail, password);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setPending(false);
    }
  }

  function fillDemo(demoEmail: string, demoPass: string) {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  }

  return (
    <div className="login-page">
      <main className="narrow login-card">
        <div className="login-header">
          <div className="brand-logo" aria-hidden="true">
            <span className="brand-logo-mark">N</span>
          </div>
          <h1>Newtonite Ops</h1>
          <p className="muted">Internal operations management. Sign in to continue.</p>
        </div>

        <form onSubmit={onSubmit} aria-label="Login" className="login-form">
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          </label>

          {error && (
            <div className="login-error-banner" role="alert">
              <AlertCircleIcon className="banner-icon" />
              <p className="error">{error}</p>
            </div>
          )}

          <button type="submit" className="btn-primary login-submit-btn" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="demo-accounts-card">
          <span className="demo-title">
            <ShieldIcon /> Seeded Demo Accounts (One-Click Fill)
          </span>
          <div className="demo-chips">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                className="demo-chip-btn"
                onClick={() => fillDemo(acc.email, acc.pass)}
                disabled={pending}
                title={`Fill ${acc.email}`}
              >
                <UserIcon />
                <span className="chip-name">{acc.label}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="muted small login-footnote">
          Demo accounts are created by the backend seed script — see README. Accounts never use
          placeholder logins: every sign-in goes to <code>POST /api/auth/login</code>.
        </p>
      </main>
    </div>
  );
}

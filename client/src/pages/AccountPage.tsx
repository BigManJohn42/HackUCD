import { useState } from "react";
import { login, logout, signup, type AuthUser } from "../api";

export function AccountPage({
  user,
  onAuthChange,
}: {
  user: AuthUser | null;
  onAuthChange: (user: AuthUser | null) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user: signedIn } = mode === "login" ? await login(email, password) : await signup(email, password);
      onAuthChange(signedIn);
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong - please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    onAuthChange(null);
  }

  if (user) {
    return (
      <section>
        <div className="page-heading">
          <span className="eyebrow">Your account</span>
          <h1>Signed in</h1>
          <p>Manage your subscription or sign out below.</p>
        </div>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            Signed in as <strong>{user.email}</strong>
          </p>
          <div className="leg-actions">
            <a className="btn-primary" href="#/subscriptions" style={{ textDecoration: "none", display: "inline-block" }}>
              Manage subscription
            </a>
            <button type="button" className="btn-secondary" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="page-heading">
        <span className="eyebrow">{mode === "login" ? "Welcome back" : "Get started"}</span>
        <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p>An account keeps your free-plan usage and Pro subscription with you across devices.</p>
      </div>
      <form className="card journey-search" onSubmit={handleSubmit}>
        <label htmlFor="account-email">Email</label>
        <input
          id="account-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="account-password">Password</label>
        <input
          id="account-password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "signup" && <p className="leg-meta">At least 8 characters.</p>}

        {error && (
          <p className="break-suggestion" role="alert" style={{ color: "var(--color-critical-text)" }}>
            {error}
          </p>
        )}

        <div className="leg-actions" style={{ marginTop: 12 }}>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setMode((m) => (m === "login" ? "signup" : "login"));
              setError(null);
            }}
          >
            {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </form>
    </section>
  );
}

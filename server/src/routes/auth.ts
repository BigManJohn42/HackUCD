import { Router } from "express";
import { AuthError, login, signToken, signup, SESSION_COOKIE } from "../services/auth.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, matches the JWT's own expiry
};

authRouter.post("/auth/signup", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  try {
    const { user, token } = await signup(email, password);
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTIONS);
    res.json({ user });
  } catch (err) {
    res.status(err instanceof AuthError ? 400 : 500).json({
      error: err instanceof Error ? err.message : "Could not create an account.",
    });
  }
});

authRouter.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  try {
    const { user, token } = await login(email, password);
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTIONS);
    res.json({ user });
  } catch (err) {
    res.status(err instanceof AuthError ? 401 : 500).json({
      error: err instanceof Error ? err.message : "Could not sign in.",
    });
  }
});

authRouter.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Re-issues a fresh cookie from a still-valid one, so an active user's
// session doesn't expire out from under them.
authRouter.post("/auth/refresh", requireAuth, (req, res) => {
  const token = signToken(req.user!);
  res.cookie(SESSION_COOKIE, token, COOKIE_OPTIONS);
  res.json({ user: req.user });
});

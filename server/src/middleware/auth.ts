import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE, verifyToken, type User } from "../services/auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Attaches req.user when a valid session cookie is present; never blocks the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const user = verifyToken(token);
    if (user) req.user = user;
  }
  next();
}

/** Blocks the request with 401 unless a valid session is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  next();
}

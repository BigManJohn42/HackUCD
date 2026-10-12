import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db/db.js";

// Same "generate once, persist locally, git-ignored" pattern as the VAPID
// keys - no manual setup step, but every restart uses the same secret so
// existing sessions/cookies keep working.
const SECRET_FILE = path.resolve(process.cwd(), ".jwt-secret");

function loadOrCreateSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    const saved = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {
    /* no saved secret yet */
  }
  const secret = crypto.randomBytes(48).toString("hex");
  try {
    fs.writeFileSync(SECRET_FILE, secret);
  } catch {
    /* sessions just won't survive a restart if we can't persist it */
  }
  return secret;
}

const JWT_SECRET = loadOrCreateSecret();
const TOKEN_TTL = "30d";
export const SESSION_COOKIE = "eirgo_session";

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export class AuthError extends Error {}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

export async function signup(email: string, password: string): Promise<{ user: User; token: string }> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new AuthError("Enter a valid email address.");
  if (password.length < 8) throw new AuthError("Password must be at least 8 characters.");

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalized);
  if (existing) throw new AuthError("An account with that email already exists.");

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    normalized,
    passwordHash,
    createdAt
  );

  const user = { id, email: normalized, createdAt };
  return { user, token: signToken(user) };
}

export async function login(email: string, password: string): Promise<{ user: User; token: string }> {
  const normalized = email.trim().toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalized) as UserRow | undefined;
  if (!row) throw new AuthError("Incorrect email or password.");

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) throw new AuthError("Incorrect email or password.");

  const user = toUser(row);
  return { user, token: signToken(user) };
}

export function signToken(user: User): string {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): User | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; email: string };
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub) as UserRow | undefined;
    return row ? toUser(row) : null;
  } catch {
    return null;
  }
}

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// The app's own data (accounts, subscriptions, saved routes) - separate from
// the read-only GTFS timetable database. Plain SQLite is a deliberate choice
// for now: zero extra infrastructure to stand up, same engine already used
// for the timetable, and a straightforward swap to Postgres later if/when
// this needs to run on more than one server process.
const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "app.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    plan TEXT,
    status TEXT NOT NULL DEFAULT 'inactive',
    current_period_end TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saved_routes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    from_place TEXT NOT NULL,
    to_place TEXT NOT NULL,
    stopovers TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes(user_id);

  CREATE TABLE IF NOT EXISTS plan_usage (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 0
  );
`);

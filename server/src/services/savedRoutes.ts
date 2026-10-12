import crypto from "node:crypto";
import { db } from "../db/db.js";

export interface Stopover {
  place: string;
  stayMins: number;
}

export interface SavedRoute {
  id: string;
  userId: string;
  name: string;
  from: string;
  to: string;
  stopovers: Stopover[];
  createdAt: string;
}

interface SavedRouteRow {
  id: string;
  user_id: string;
  name: string;
  from_place: string;
  to_place: string;
  stopovers: string;
  created_at: string;
}

function toSavedRoute(row: SavedRouteRow): SavedRoute {
  let stopovers: Stopover[] = [];
  try {
    stopovers = JSON.parse(row.stopovers);
  } catch {
    /* corrupt/empty stopovers just means none */
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    from: row.from_place,
    to: row.to_place,
    stopovers,
    createdAt: row.created_at,
  };
}

const MAX_SAVED_ROUTES_PER_USER = 50;

export function listSavedRoutes(userId: string): SavedRoute[] {
  const rows = db
    .prepare("SELECT * FROM saved_routes WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as unknown as SavedRouteRow[];
  return rows.map(toSavedRoute);
}

export class SavedRouteError extends Error {}

export function createSavedRoute(
  userId: string,
  name: string,
  from: string,
  to: string,
  stopovers: Stopover[]
): SavedRoute {
  const count = db.prepare("SELECT COUNT(*) as n FROM saved_routes WHERE user_id = ?").get(userId) as {
    n: number;
  };
  if (count.n >= MAX_SAVED_ROUTES_PER_USER) {
    throw new SavedRouteError(`You can save up to ${MAX_SAVED_ROUTES_PER_USER} routes.`);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO saved_routes (id, user_id, name, from_place, to_place, stopovers, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, name, from, to, JSON.stringify(stopovers), createdAt);

  return { id, userId, name, from, to, stopovers, createdAt };
}

/** Returns true if a row was deleted; false if it didn't exist or belonged to someone else. */
export function deleteSavedRoute(userId: string, routeId: string): boolean {
  const result = db.prepare("DELETE FROM saved_routes WHERE id = ? AND user_id = ?").run(routeId, userId);
  return result.changes > 0;
}

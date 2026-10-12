import { db } from "../db/db.js";

// Must match client/src/planAllowance.ts's FREE_PLAN_LIMIT - that copy governs
// the pre-signup anonymous trial (client-side, intentionally soft/gameable, so
// it doesn't block people from trying the product before creating an account).
// This one is the real, account-tied limit once someone's logged in - it's
// enforced server-side so clearing browser storage can't reset it.
export const FREE_PLAN_LIMIT = 5;

export function getUsage(userId: string): number {
  const row = db.prepare("SELECT count FROM plan_usage WHERE user_id = ?").get(userId) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

export function incrementUsage(userId: string): number {
  db.prepare(
    `INSERT INTO plan_usage (user_id, count) VALUES (?, 1)
     ON CONFLICT(user_id) DO UPDATE SET count = count + 1`
  ).run(userId);
  return getUsage(userId);
}

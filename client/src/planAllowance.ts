// Free tier: a handful of real journey plans, then ÉirGo Pro for unlimited planning.
// Counted in this browser only - fine for the prototype, but a real launch would track
// usage per account on the server so it can't be reset by clearing site data.

export const FREE_PLAN_LIMIT = 5;
const STORAGE_KEY = "eirgo-free-plans-used";

export function freePlansUsed(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function recordFreePlan(): number {
  const used = freePlansUsed() + 1;
  try {
    localStorage.setItem(STORAGE_KEY, String(used));
  } catch {
    /* storage unavailable: the allowance just won't persist */
  }
  return used;
}

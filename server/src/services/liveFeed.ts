import { DatabaseSync } from "node:sqlite";
import type { Server, Socket } from "socket.io";
import { belfieldToCityCentre } from "../data/corridor.js";
import type { AlertKind, LiveStatus, RouteAlert, WatchedLeg } from "../types.js";
import { getTripUpdates } from "../../../src/nta.js";
import { DB_PATH, findStops } from "../../../src/timetable.js";
import { liveStatusFor, type TripUpdateRow } from "./plannerBridge.js";
import { pushScopedAlert } from "./push.js";

const POLL_INTERVAL_MS = 25_000;
const LATE_MIN = 5; // a delay worth telling someone about
const CHANGE_MIN = 5; // re-alert only when the delay moves by at least this much
const LUAS_ROUTE_TYPE = 0; // GTFS route_type: 0 = tram/Luas

let db: DatabaseSync | null = null;
const routeTypeCache = new Map<string, number | null>();

/** Luas's live feed matches delays to the wrong scheduled trips (often "early" by
 * an hour), so - like the per-leg badges in plannerBridge.ts - alerts ignore it too,
 * rather than show confidently wrong disruption banners. */
function isLuasRoute(routeId: string | null | undefined): boolean {
  if (!routeId) return false;
  if (routeTypeCache.has(routeId)) return routeTypeCache.get(routeId) === LUAS_ROUTE_TYPE;
  try {
    db ??= new DatabaseSync(DB_PATH, { readOnly: true });
    const row = db.prepare("SELECT route_type FROM routes WHERE route_id = ?").get(routeId) as
      | { route_type: number }
      | undefined;
    routeTypeCache.set(routeId, row?.route_type ?? null);
    return row?.route_type === LUAS_ROUTE_TYPE;
  } catch {
    return false; // DB not built yet - don't block alerts over it
  }
}

const stopIdCache = new Map<string, string | undefined>();
function stopIdForCode(code: string | null): string | undefined {
  if (!code) return undefined;
  if (!stopIdCache.has(code)) stopIdCache.set(code, findStops(code)[0]?.stop_id);
  return stopIdCache.get(code);
}

/** "14:02" + 11 -> "14:13" (ignores any "(+1 day)" suffix). */
function addMinutes(hhmm: string | null, mins: number): string | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const total = (Number(m[1]) * 60 + Number(m[2]) + mins + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

interface TripState {
  status: LiveStatus["status"];
  delayMin: number;
}

const isLate = (s: TripState) => s.status === "late" && s.delayMin >= LATE_MIN;

/**
 * Decide whether a trip's live status has changed enough since the user last
 * heard about it (the plan itself, or the previous alert) to be worth an alert.
 */
function decide(prev: TripState, now: TripState, leg: WatchedLeg): RouteAlert | null {
  const ride = leg.boardAt ? `the ${leg.boardAt} ${leg.label}` : leg.label;
  const where = leg.fromName ? ` from ${leg.fromName}` : "";
  const make = (kind: AlertKind, severity: RouteAlert["severity"], title: string, message: string): RouteAlert => ({
    id: `${leg.tripId}-${kind}-${now.delayMin}-${Date.now()}`,
    legId: leg.legId,
    optionId: leg.optionId,
    tripId: leg.tripId,
    kind,
    severity,
    title,
    message,
    delayMin: now.delayMin,
    timestamp: new Date().toISOString(),
  });
  const shortLabel = leg.label.split(" towards ")[0];

  if (now.status === "cancelled" && prev.status !== "cancelled") {
    return make("cancelled", "critical", `${shortLabel} cancelled`, `${capitalise(ride)}${where} has been cancelled.`);
  }
  if (now.status === "skipped" && prev.status !== "skipped") {
    return make("skipped", "critical", `${shortLabel} won't stop for you`, `${capitalise(ride)} is not stopping at ${leg.fromName}.`);
  }
  if (now.status === "cancelled" || now.status === "skipped") return null;

  const expected = addMinutes(leg.boardAt, now.delayMin);
  const expectedText = expected ? ` - expected around ${expected}` : "";
  if (isLate(now)) {
    if (!isLate(prev)) {
      return make("late", "warning", `${shortLabel} is ${now.delayMin} min late`, `${capitalise(ride)}${where} is running ${now.delayMin} min late${expectedText}.`);
    }
    if (now.delayMin - prev.delayMin >= CHANGE_MIN) {
      return make("worse", "warning", `${shortLabel} delay now ${now.delayMin} min`, `${capitalise(ride)} has slipped further: now ${now.delayMin} min late${expectedText}.`);
    }
    if (prev.delayMin - now.delayMin >= CHANGE_MIN) {
      return make("improved", "info", `${shortLabel} catching up`, `${capitalise(ride)} is now only ${now.delayMin} min late${expectedText}.`);
    }
    return null;
  }
  if (isLate(prev) || prev.status === "cancelled" || prev.status === "skipped") {
    return make("recovered", "info", `${shortLabel} back on schedule`, `${capitalise(ride)} is running on time again.`);
  }
  return null;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Real delays/cancellations from NTA's live GTFS-Realtime feed, per watched trip. */
async function pollRealFeed(): Promise<Map<string, TripUpdateRow[]>> {
  const { rows } = (await getTripUpdates()) as { rows: (TripUpdateRow & { routeId?: string | null })[] };
  const byTrip = new Map<string, TripUpdateRow[]>();
  for (const row of rows) {
    if (!row.tripId || isLuasRoute(row.routeId)) continue;
    if (!byTrip.has(row.tripId)) byTrip.set(row.tripId, []);
    byTrip.get(row.tripId)!.push(row);
  }
  return byTrip;
}

function alertsForSocket(socket: Socket, byTrip: Map<string, TripUpdateRow[]>): RouteAlert[] {
  const legs = (socket.data.watchedLegs as WatchedLeg[] | undefined) ?? [];
  // Last status the user knows about, per trip: starts from what their plan showed.
  const known = ((socket.data.tripStates as Map<string, TripState> | undefined) ??= new Map());
  const alerts: RouteAlert[] = [];

  for (const leg of legs) {
    const updates = byTrip.get(leg.tripId);
    if (!updates) continue; // not running yet / no live data: nothing new to say
    const live = liveStatusFor(updates, stopIdForCode(leg.boardStopCode));
    if (live.status === "scheduled") continue;

    const now: TripState = { status: live.status, delayMin: live.delayMin ?? 0 };
    const prev: TripState = known.get(leg.tripId) ?? {
      status: leg.knownStatus as LiveStatus["status"],
      delayMin: leg.knownDelayMin,
    };
    const alert = decide(prev, now, leg);
    // Remember what was last *told* to the user (not every small drift), so a delay
    // creeping 5 -> 6 -> 7 ... -> 10 still triggers a "worse" alert eventually.
    if (alert || !known.has(leg.tripId)) known.set(leg.tripId, alert ? now : prev);
    if (alert) alerts.push(alert);
  }
  return alerts;
}

// Simulated fallback: produces the same shape of delay/cancellation events on
// the same polling cadence a real integration would use, so the UI (socket
// relay, chat context, banners) can be built and demoed without an API key.
// Scoped to the sample corridor's own leg/option ids, same as a real client
// would only ever see alerts for legs actually in its itinerary.
function simulateOnce(): RouteAlert | null {
  const legsWithTransit = belfieldToCityCentre.legs.filter((leg) =>
    leg.options.some((o) => o.departures.length > 0)
  );
  if (legsWithTransit.length === 0) return null;
  if (Math.random() > 0.35) return null;

  const leg = legsWithTransit[Math.floor(Math.random() * legsWithTransit.length)];
  const option = leg.options.find((o) => o.departures.length > 0)!;
  const base = { id: `sim-${Date.now()}`, legId: leg.id, optionId: option.id, timestamp: new Date().toISOString() };

  const kind = Math.random();
  if (kind < 0.6) {
    const delay = 5 + Math.floor(Math.random() * 10);
    return {
      ...base,
      kind: "late",
      severity: "warning",
      title: `${option.label} is ${delay} min late`,
      message: `${option.label} is running about ${delay} min late.`,
      delayMin: delay,
    };
  }
  if (kind < 0.85) {
    return {
      ...base,
      kind: "cancelled",
      severity: "critical",
      title: `${option.label} cancelled`,
      message: `${option.label} at ${option.departures[0]} has been cancelled.`,
    };
  }
  return {
    ...base,
    kind: "recovered",
    severity: "info",
    title: `${option.label} back on schedule`,
    message: `${option.label} is back on schedule.`,
  };
}

export function startLiveFeed(io: Server) {
  const useRealFeed = Boolean(process.env.NTA_API_KEY);
  if (useRealFeed) console.log("[liveFeed] NTA_API_KEY set - polling the real GTFS-Realtime feed.");
  else console.log("[liveFeed] No NTA_API_KEY - using the simulated delay feed.");

  const timer = setInterval(async () => {
    // Push subscriptions can still be live with no socket connected (tab
    // backgrounded or closed), so this doesn't early-return on zero sockets -
    // the real feed poll is cheap anyway (nta.js caches it for 60s).
    const sockets = [...io.sockets.sockets.values()];

    if (useRealFeed) {
      const watching = sockets.filter((s) => ((s.data.watchedLegs as WatchedLeg[] | undefined) ?? []).length > 0);
      if (watching.length === 0) return; // don't spend the 1 call/min budget when nobody's journey has rides
      try {
        const byTrip = await pollRealFeed();
        const allAlerts: RouteAlert[] = [];
        for (const socket of watching) {
          const alerts = alertsForSocket(socket, byTrip);
          alerts.forEach((alert) => socket.emit("route-alert", alert));
          allAlerts.push(...alerts);
        }
        await Promise.all(allAlerts.map((alert) => pushScopedAlert(alert)));
      } catch (err) {
        console.error("[liveFeed] real feed poll failed:", err instanceof Error ? err.message : err);
      }
      return;
    }

    const alert = simulateOnce();
    if (!alert) return;
    for (const socket of sockets) {
      const optionIds = (socket.data.watchedOptionIds as Set<string> | undefined) ?? new Set();
      if (optionIds.has(alert.optionId)) socket.emit("route-alert", alert);
    }
    await pushScopedAlert(alert);
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}

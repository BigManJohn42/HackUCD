import { DatabaseSync } from "node:sqlite";
import type { Server, Socket } from "socket.io";
import { belfieldToCityCentre } from "../data/corridor.js";
import type { RouteAlert } from "../types.js";
import { getTripUpdates } from "../../../src/nta.js";
import { DB_PATH } from "../../../src/timetable.js";
import { pushScopedAlert } from "./push.js";

const POLL_INTERVAL_MS = 25_000;
const DELAY_THRESHOLD_SECS = 300; // only surface delays of 5+ minutes
const LUAS_ROUTE_TYPE = 0; // GTFS route_type: 0 = tram/Luas

const emittedRecently = new Set<string>();

let db: DatabaseSync | null = null;
const routeTypeCache = new Map<string, number | null>();

/** Luas's live feed matches delays to the wrong scheduled trips (often "early" by
 * an hour), so - like the per-leg badges in plannerBridge.ts - the general alert
 * ticker ignores it too, rather than show confidently wrong disruption banners. */
function isLuasRoute(routeId: string | null): boolean {
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

interface ScopedAlert extends RouteAlert {
  tripId: string;
}

interface TripUpdateRow {
  tripId: string | null;
  routeId: string | null;
  tripStatus: string;
  stopId: string | null;
  stopStatus?: string;
  delay: number | null;
}

// Real delays/cancellations from NTA's live GTFS-Realtime feed (Dublin Bus,
// Bus Eireann, Go-Ahead). Requires NTA_API_KEY in .env; falls back to the
// simulated feed below when it isn't set, same pattern as the OpenRouter and
// Stripe integrations elsewhere in this app.
async function pollRealFeed(): Promise<ScopedAlert[]> {
  const { rows } = (await getTripUpdates()) as { rows: TripUpdateRow[] };
  const alerts: ScopedAlert[] = [];

  for (const row of rows) {
    if (isLuasRoute(row.routeId)) continue;
    const isCancelled = row.tripStatus === "CANCELED" || row.stopStatus === "SKIPPED";
    const isLate = typeof row.delay === "number" && row.delay >= DELAY_THRESHOLD_SECS;
    if (!isCancelled && !isLate) continue;
    if (!row.tripId) continue;

    const dedupeKey = `${row.tripId}-${row.stopId ?? "trip"}-${isCancelled ? "cancelled" : "late"}`;
    if (emittedRecently.has(dedupeKey)) continue;
    emittedRecently.add(dedupeKey);

    const routeLabel = row.routeId ? `Route ${row.routeId}` : "A service";
    alerts.push({
      legId: "",
      optionId: row.tripId,
      tripId: row.tripId,
      severity: isCancelled ? "critical" : "warning",
      message: isCancelled
        ? `${routeLabel} has a cancelled stop on its current trip.`
        : `${routeLabel} is running about ${Math.round((row.delay as number) / 60)} min late.`,
      timestamp: new Date().toISOString(),
    });
  }

  // Keep the dedupe set from growing forever across a long-running demo.
  if (emittedRecently.size > 500) emittedRecently.clear();

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

  const kind = Math.random();
  if (kind < 0.6) {
    const delay = 5 + Math.floor(Math.random() * 10);
    return {
      legId: leg.id,
      optionId: option.id,
      severity: "warning",
      message: `${option.label} is running about ${delay} min late.`,
      timestamp: new Date().toISOString(),
    };
  }
  if (kind < 0.85) {
    return {
      legId: leg.id,
      optionId: option.id,
      severity: "critical",
      message: `${option.label} at ${option.departures[0]} has been cancelled.`,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    legId: leg.id,
    optionId: option.id,
    severity: "info",
    message: `${option.label} is back on schedule.`,
    timestamp: new Date().toISOString(),
  };
}

function watchedSets(socket: Socket): { optionIds: Set<string>; tripIds: Set<string> } {
  return {
    optionIds: (socket.data.watchedOptionIds as Set<string> | undefined) ?? new Set(),
    tripIds: (socket.data.watchedTripIds as Set<string> | undefined) ?? new Set(),
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
      try {
        const alerts = await pollRealFeed();
        for (const socket of sockets) {
          const { tripIds } = watchedSets(socket);
          alerts.filter((a) => tripIds.has(a.tripId)).slice(0, 3).forEach((alert) => socket.emit("route-alert", alert));
        }
        await Promise.all(alerts.map((alert) => pushScopedAlert(alert)));
      } catch (err) {
        console.error("[liveFeed] real feed poll failed:", err);
      }
      return;
    }

    const alert = simulateOnce();
    if (!alert) return;
    for (const socket of sockets) {
      const { optionIds } = watchedSets(socket);
      if (optionIds.has(alert.optionId)) socket.emit("route-alert", alert);
    }
    await pushScopedAlert(alert);
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}

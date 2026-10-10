import type { Server } from "socket.io";
import { belfieldToCityCentre } from "../data/corridor.js";
import type { RouteAlert } from "../types.js";
import { getTripUpdates } from "../../../src/nta.js";

const POLL_INTERVAL_MS = 25_000;
const DELAY_THRESHOLD_SECS = 300; // only surface delays of 5+ minutes

const emittedRecently = new Set<string>();

// Real delays/cancellations from NTA's live GTFS-Realtime feed (Dublin Bus,
// Bus Eireann, Go-Ahead). Requires NTA_API_KEY in .env; falls back to the
// simulated feed below when it isn't set, same pattern as the OpenRouter and
// Stripe integrations elsewhere in this app.
async function pollRealFeed(): Promise<RouteAlert[]> {
  const { rows } = await getTripUpdates();
  const alerts: RouteAlert[] = [];

  for (const row of rows) {
    const isCancelled = row.tripStatus === "CANCELED" || row.stopStatus === "SKIPPED";
    const isLate = typeof row.delay === "number" && row.delay >= DELAY_THRESHOLD_SECS;
    if (!isCancelled && !isLate) continue;

    const dedupeKey = `${row.tripId}-${row.stopId ?? "trip"}-${isCancelled ? "cancelled" : "late"}`;
    if (emittedRecently.has(dedupeKey)) continue;
    emittedRecently.add(dedupeKey);

    const routeLabel = row.routeId ? `Route ${row.routeId}` : "A service";
    alerts.push({
      legId: "",
      optionId: row.tripId ?? "",
      severity: isCancelled ? "critical" : "warning",
      message: isCancelled
        ? `${routeLabel} has a cancelled stop on its current trip.`
        : `${routeLabel} is running about ${Math.round((row.delay as number) / 60)} min late.`,
      timestamp: new Date().toISOString(),
    });
  }

  // Keep the dedupe set from growing forever across a long-running demo.
  if (emittedRecently.size > 500) emittedRecently.clear();

  return alerts.slice(0, 3);
}

// Simulated fallback: produces the same shape of delay/cancellation events on
// the same polling cadence a real integration would use, so the UI (socket
// relay, chat context, banners) can be built and demoed without an API key.
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

export function startLiveFeed(io: Server) {
  const useRealFeed = Boolean(process.env.NTA_API_KEY);
  if (useRealFeed) console.log("[liveFeed] NTA_API_KEY set - polling the real GTFS-Realtime feed.");
  else console.log("[liveFeed] No NTA_API_KEY - using the simulated delay feed.");

  const timer = setInterval(async () => {
    if (useRealFeed) {
      try {
        const alerts = await pollRealFeed();
        alerts.forEach((alert) => io.emit("route-alert", alert));
      } catch (err) {
        console.error("[liveFeed] real feed poll failed:", err);
      }
      return;
    }
    const alert = simulateOnce();
    if (alert) io.emit("route-alert", alert);
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}

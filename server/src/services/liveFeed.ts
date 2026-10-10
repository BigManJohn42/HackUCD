import type { Server } from "socket.io";
import { belfieldToCityCentre } from "../data/corridor.js";
import type { RouteAlert } from "../types.js";

const POLL_INTERVAL_MS = 25_000;

// Real NTA GTFS-Realtime (https://developer.nationaltransport.ie) is a pull
// feed (protobuf over HTTP), not a push stream, so the *correct* place to
// poll it is here on the server. This stub simulates delay/cancellation
// events on the same schedule so the rest of the app (socket relay, chat
// context, UI banners) can be built and demoed against it. Replace the body
// of `pollOnce` with a real fetch + GTFS-RT TripUpdate parse when an API key
// is available; nothing downstream needs to change.
function pollOnce(): RouteAlert | null {
  const legsWithTransit = belfieldToCityCentre.legs.filter((leg) =>
    leg.options.some((o) => o.departures.length > 0)
  );
  if (legsWithTransit.length === 0) return null;

  // Roughly 1-in-3 polls produce a live alert, so the demo shows both a
  // quiet state and an active one without feeling scripted.
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
  const timer = setInterval(() => {
    const alert = pollOnce();
    if (alert) io.emit("route-alert", alert);
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}

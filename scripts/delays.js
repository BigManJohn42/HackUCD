// Print live delays from the NTA feed.
//   npm run delays                       -> summary + most delayed trips
//   npm run delays -- --stop <stop_id>   -> upcoming live times at one stop
//   npm run delays -- --route <route_id> -> live status of trips on one route
import { getTripUpdates, getVehiclePositions } from "../src/nta.js";
import { loadGtfs, routeLabel } from "../src/gtfs.js";

// Static timetable is optional here: without it we fall back to raw ids.
const gtfs = await loadGtfs().catch((err) => {
  console.warn(`(No static timetable, showing ids only: ${err.message})\n`);
  return { stops: new Map(), routes: new Map(), trips: new Map() };
});
const stopName = (id) => gtfs.stops.get(id)?.name ?? id;
const routeName = (r) => (gtfs.routes.has(r.routeId) ? routeLabel(gtfs.routes.get(r.routeId)) : r.routeId);
const headsign = (r) => gtfs.trips.get(r.tripId)?.headsign ?? "";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const stopId = opt("stop");
const routeId = opt("route");

const fmtDelay = (s) => (s == null ? "?" : `${s >= 0 ? "+" : ""}${Math.round(s / 60)} min`);
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleTimeString("en-IE") : "");

const [{ timestamp, rows }, { vehicles }] = await Promise.all([
  getTripUpdates(),
  getVehiclePositions(),
]);

console.log(`Feed time: ${fmtTime(timestamp)}`);
console.log(`Trip updates: ${new Set(rows.map((r) => r.tripId)).size} trips, ${rows.length} stop updates`);
console.log(`Vehicles with positions: ${vehicles.length}\n`);

let selected = rows;
if (stopId) selected = selected.filter((r) => r.stopId === stopId);
if (routeId) selected = selected.filter((r) => r.routeId === routeId);

if (stopId || routeId) {
  if (!selected.length) console.log("No live updates match that filter.");
  console.table(
    selected.map((r) => ({
      route: routeName(r),
      to: headsign(r),
      stop: stopName(r.stopId),
      seq: r.stopSequence,
      status: r.tripStatus === "SCHEDULED" ? r.stopStatus : r.tripStatus,
      delay: fmtDelay(r.delay),
      time: fmtTime(r.time),
    })),
  );
} else {
  const cancelled = new Set(rows.filter((r) => r.tripStatus === "CANCELED").map((r) => r.tripId));
  console.log(`Cancelled trips: ${cancelled.size}`);

  // Worst current delay per trip.
  const worst = new Map();
  for (const r of rows) {
    if (r.delay == null) continue;
    if (!worst.has(r.tripId) || r.delay > worst.get(r.tripId).delay) worst.set(r.tripId, r);
  }
  const top = [...worst.values()].sort((a, b) => b.delay - a.delay).slice(0, 15);
  console.log("\nMost delayed trips:");
  console.table(
    top.map((r) => ({ route: routeName(r), to: headsign(r), stop: stopName(r.stopId), delay: fmtDelay(r.delay) })),
  );
}

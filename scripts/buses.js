// Departures board for a bus stop: timetable + live delays (when NTA_API_KEY works).
//   npm run buses -- 768              -> by stop number (the number on the bus stop pole)
//   npm run buses -- "ucd belfield"   -> by name (all stops with that name, e.g. both sides of the road)
//   npm run buses -- belfield 30      -> only the next 30 minutes
import { findStops, scheduledDepartures, fmtSecs } from "../src/timetable.js";
import { getTripUpdates } from "../src/nta.js";

const args = process.argv.slice(2);
const windowMins = /^\d+$/.test(args.at(-1) ?? "") && args.length > 1 ? Number(args.pop()) : 60;
const query = args.join(" ");
if (!query) {
  console.error('Usage: npm run buses -- <stop number or name> [minutes]');
  process.exit(1);
}

const matches = findStops(query);
if (!matches.length) {
  console.log(`No stop matches "${query}". Try part of the name, or the number on the stop.`);
  process.exit(1);
}

// Use every stop sharing the first match's name (usually both sides of the road); list the rest.
const name = matches[0].stop_name;
const stops = matches.filter((s) => s.stop_name === name);
const others = [...new Set(matches.map((s) => s.stop_name))].filter((n) => n !== name);
if (others.length) {
  console.log(`Also matching: ${others.slice(0, 8).join(", ")}${others.length > 8 ? `, +${others.length - 8} more` : ""}\n`);
}

// Live delays, keyed by trip. Falls back to timetable only if the feed is unavailable.
const live = new Map();
let liveNote = "";
try {
  const { rows } = await getTripUpdates();
  for (const r of rows) {
    if (!live.has(r.tripId)) live.set(r.tripId, []);
    live.get(r.tripId).push(r);
  }
  liveNote = `live data for ${live.size} trips`;
} catch (err) {
  liveNote = `timetable only - live data unavailable (${err.message})`;
}

/** Delay at our stop: the update for this stop, else the latest one before it (delays carry forward). */
function liveStatus(dep) {
  const updates = live.get(dep.trip_id);
  if (!updates) return { status: "scheduled", delay: 0 };
  if (updates.some((u) => u.tripStatus === "CANCELED")) return { status: "CANCELLED", delay: null };
  const prior = updates
    .filter((u) => u.stopSequence == null || u.stopSequence <= dep.stop_sequence)
    .sort((a, b) => (b.stopSequence ?? 0) - (a.stopSequence ?? 0));
  const here = updates.find((u) => u.stopId === dep.stop_id) ?? prior[0];
  if (here?.stopStatus === "SKIPPED") return { status: "SKIPPED", delay: null };
  const delay = here?.delay ?? 0;
  const mins = Math.round(delay / 60);
  return { status: mins > 0 ? `${mins} min late` : mins < 0 ? `${-mins} min early` : "on time", delay };
}

const deps = scheduledDepartures(stops.map((s) => s.stop_id), { windowMins });
console.log(`${name} - stops ${stops.map((s) => s.stop_code ?? s.stop_id).join(", ")}`);
console.log(`Next ${windowMins} min, ${new Date().toLocaleTimeString("en-IE")} (${liveNote})\n`);

if (!deps.length) console.log("No departures scheduled.");
else
  console.table(
    deps.map((d) => {
      const { status, delay } = liveStatus(d);
      return {
        route: d.short_name ?? d.long_name ?? d.route_id,
        to: d.headsign ?? "",
        stop: d.stop_code ?? d.stop_id,
        scheduled: fmtSecs(d.departure),
        expected: delay == null ? "-" : fmtSecs(d.departure + delay),
        due: delay == null ? "-" : `${Math.max(0, d.minsAway + Math.round(delay / 60))} min`,
        status,
      };
    }),
  );

// Scheduled timetable queries against data/gtfs.db (built by `npm run gtfs:update`).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GTFS_DIR } from "./gtfs.js";

export const DB_PATH = path.join(GTFS_DIR, "..", "gtfs.db");

let db;
function open() {
  if (!db) {
    if (!fs.existsSync(DB_PATH)) throw new Error(`${DB_PATH} not found - run \`npm run gtfs:update\``);
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  return db;
}

/** Current Irish local time as { date: "YYYYMMDD", secs: seconds since midnight, weekday: 0=Mon..6=Sun }. */
export function irishNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    secs: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday),
  };
}

const shiftDate = (yyyymmdd, days) => {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + days));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
};
const weekdayOf = (yyyymmdd) =>
  (new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8))).getUTCDay() + 6) % 7;

/** service_ids running on a date, applying calendar_dates additions/removals. */
export function activeServices(date) {
  const d = open();
  const weekday = weekdayOf(date);
  const ids = new Set(
    d.prepare("SELECT service_id, days FROM calendar WHERE start_date <= ? AND end_date >= ?").all(date, date)
      .filter((r) => r.days[weekday] === "1")
      .map((r) => r.service_id),
  );
  for (const r of d.prepare("SELECT service_id, exception_type FROM calendar_dates WHERE date = ?").all(date)) {
    if (r.exception_type === 1) ids.add(r.service_id);
    else ids.delete(r.service_id);
  }
  return ids;
}

/** Search stops by stop code (the number on the bus stop pole) or name. */
export function findStops(query) {
  const d = open();
  const q = query.trim();
  const byCode = d.prepare("SELECT * FROM stops WHERE stop_code = ? OR stop_id = ?").all(q, q);
  if (byCode.length) return byCode;
  // Rank exact name matches first, then names starting with the query, then the rest.
  return d
    .prepare(`
      SELECT * FROM stops WHERE stop_name LIKE :contains
      ORDER BY (stop_name LIKE :exact) DESC, (stop_name LIKE :prefix) DESC, length(stop_name), stop_name
      LIMIT 200`)
    .all({ exact: q, prefix: `${q}%`, contains: `%${q}%` });
}

/**
 * Scheduled departures from the given stops in the next `windowMins`, earliest first.
 * Includes trips from yesterday's service that run past midnight (GTFS times > 24:00).
 */
export function scheduledDepartures(stopIds, { windowMins = 60, at = new Date() } = {}) {
  const d = open();
  const now = irishNow(at);
  const query = d.prepare(`
    SELECT st.trip_id, st.stop_id, st.stop_sequence, st.departure, t.service_id, t.headsign,
           r.route_id, r.short_name, r.long_name, r.route_type, s.stop_code, s.stop_name
    FROM stop_times st
    JOIN trips t ON t.trip_id = st.trip_id
    JOIN routes r ON r.route_id = t.route_id
    JOIN stops s ON s.stop_id = st.stop_id
    WHERE st.stop_id = ? AND st.departure BETWEEN ? AND ?
  `);

  const out = [];
  // dayOffset 0 = today's service, -1 = yesterday's service still running after midnight
  for (const dayOffset of [0, -1]) {
    const serviceDate = shiftDate(now.date, dayOffset);
    const services = activeServices(serviceDate);
    const from = now.secs - dayOffset * 86400;
    for (const stopId of stopIds) {
      for (const row of query.all(stopId, from, from + windowMins * 60)) {
        if (!services.has(row.service_id)) continue;
        out.push({ ...row, serviceDate, minsAway: Math.round((row.departure - from) / 60) });
      }
    }
  }
  return out.sort((a, b) => a.minsAway - b.minsAway);
}

/** "HH:MM" for GTFS seconds-since-midnight (wraps past 24:00). */
export const fmtSecs = (secs) => {
  const h = Math.floor(secs / 3600) % 24;
  const m = Math.floor((secs % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

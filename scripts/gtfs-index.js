// Build data/gtfs.db (SQLite) from the extracted GTFS text files so timetable
// queries are instant. Run automatically by `npm run gtfs:update`.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GTFS_DIR, readTable } from "../src/gtfs.js";
import { DB_PATH } from "../src/timetable.js";

const toSecs = (t) => {
  if (!t) return null;
  const [h, m, s] = t.split(":").map(Number); // hours can exceed 24 for after-midnight trips
  return h * 3600 + m * 60 + (s || 0);
};

const tmpPath = `${DB_PATH}.tmp`;
fs.rmSync(tmpPath, { force: true });
const db = new DatabaseSync(tmpPath);
db.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;
  CREATE TABLE stops (stop_id TEXT PRIMARY KEY, stop_code TEXT, stop_name TEXT, lat REAL, lon REAL);
  CREATE TABLE routes (route_id TEXT PRIMARY KEY, agency_id TEXT, short_name TEXT, long_name TEXT, route_type INTEGER);
  CREATE TABLE trips (trip_id TEXT PRIMARY KEY, route_id TEXT, service_id TEXT, headsign TEXT, direction_id INTEGER);
  CREATE TABLE stop_times (trip_id TEXT, stop_id TEXT, stop_sequence INTEGER, arrival INTEGER, departure INTEGER);
  CREATE TABLE calendar (service_id TEXT PRIMARY KEY, days TEXT, start_date TEXT, end_date TEXT);
  CREATE TABLE calendar_dates (service_id TEXT, date TEXT, exception_type INTEGER);
`);

async function load(table, file, columns, map, { optional = false } = {}) {
  if (!fs.existsSync(path.join(GTFS_DIR, `${file}.txt`))) {
    if (optional) return console.log(`  ${file.padEnd(16)} (not in feed)`);
  }
  const insert = db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  const started = Date.now();
  let n = 0;
  db.exec("BEGIN");
  await readTable(file, (row) => {
    insert.run(...map(row));
    if (++n % 500_000 === 0) {
      db.exec("COMMIT; BEGIN");
      process.stdout.write(`\r  ${file.padEnd(16)} ${n.toLocaleString()} rows...`);
    }
  });
  db.exec("COMMIT");
  console.log(`\r  ${file.padEnd(16)} ${n.toLocaleString()} rows (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

console.log(`Indexing ${GTFS_DIR}`);
await load("stops", "stops", ["stop_id", "stop_code", "stop_name", "lat", "lon"], (r) => [
  r.stop_id, r.stop_code || null, r.stop_name, Number(r.stop_lat), Number(r.stop_lon),
]);
await load("routes", "routes", ["route_id", "agency_id", "short_name", "long_name", "route_type"], (r) => [
  r.route_id, r.agency_id || null, r.route_short_name || null, r.route_long_name || null, Number(r.route_type),
]);
await load("trips", "trips", ["trip_id", "route_id", "service_id", "headsign", "direction_id"], (r) => [
  r.trip_id, r.route_id, r.service_id, r.trip_headsign || null, r.direction_id === "" ? null : Number(r.direction_id),
]);
await load("calendar", "calendar", ["service_id", "days", "start_date", "end_date"], (r) => [
  r.service_id,
  [r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday, r.sunday].join(""),
  r.start_date, r.end_date,
], { optional: true });
await load("calendar_dates", "calendar_dates", ["service_id", "date", "exception_type"], (r) => [
  r.service_id, r.date, Number(r.exception_type),
], { optional: true });
await load("stop_times", "stop_times", ["trip_id", "stop_id", "stop_sequence", "arrival", "departure"], (r) => [
  r.trip_id, r.stop_id, Number(r.stop_sequence), toSecs(r.arrival_time), toSecs(r.departure_time || r.arrival_time),
]);

console.log("  building indexes...");
db.exec(`
  CREATE INDEX stop_times_by_stop ON stop_times (stop_id, departure);
  CREATE INDEX stop_times_by_trip ON stop_times (trip_id, stop_sequence);
  CREATE INDEX stops_by_code ON stops (stop_code);
  CREATE INDEX calendar_dates_by_date ON calendar_dates (date);
`);
db.close();
fs.rmSync(DB_PATH, { force: true });
fs.renameSync(tmpPath, DB_PATH);
console.log(`Wrote ${DB_PATH} (${(fs.statSync(DB_PATH).size / 1e6).toFixed(0)} MB)`);

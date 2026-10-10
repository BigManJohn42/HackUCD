// Static GTFS timetable data (stops, routes, trips) loaded from data/gtfs/.
// Run `npm run gtfs:update` first to download it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse";

export const GTFS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "gtfs");

/** Stream a GTFS .txt file, calling onRow for each record (as an object keyed by header). */
export async function readTable(name, onRow) {
  const file = path.join(GTFS_DIR, `${name}.txt`);
  if (!fs.existsSync(file)) throw new Error(`${file} not found - run \`npm run gtfs:update\``);

  const parser = fs.createReadStream(file).pipe(parse({ columns: true, bom: true, skip_empty_lines: true, trim: true }));
  for await (const row of parser) onRow(row);
}

async function loadById(name, idField, pick) {
  const map = new Map();
  await readTable(name, (row) => map.set(row[idField], pick(row)));
  return map;
}

let loading;

/** Load stops, routes and trips into Maps keyed by id. Cached after the first call. */
export function loadGtfs() {
  loading ??= (async () => {
    const [stops, routes, trips] = await Promise.all([
      loadById("stops", "stop_id", (r) => ({
        id: r.stop_id,
        code: r.stop_code || null,
        name: r.stop_name,
        lat: Number(r.stop_lat),
        lon: Number(r.stop_lon),
      })),
      loadById("routes", "route_id", (r) => ({
        id: r.route_id,
        agencyId: r.agency_id || null,
        shortName: r.route_short_name || null,
        longName: r.route_long_name || null,
        type: Number(r.route_type), // 0 tram, 2 rail, 3 bus
      })),
      loadById("trips", "trip_id", (r) => ({
        id: r.trip_id,
        routeId: r.route_id,
        serviceId: r.service_id,
        headsign: r.trip_headsign || null,
        directionId: r.direction_id === "" ? null : Number(r.direction_id),
      })),
    ]);
    return { stops, routes, trips };
  })();
  return loading;
}

/** Display name for a route, e.g. "DART Bray - Howth" or "46A". */
export const routeLabel = (route) =>
  [route?.shortName === "rail" ? null : route?.shortName, route?.longName].filter(Boolean).join(" ") ||
  route?.id ||
  "?";

/** Case-insensitive search of stops by name or code. */
export function searchStops(stops, query) {
  const q = query.toLowerCase();
  return [...stops.values()].filter((s) => s.name.toLowerCase().includes(q) || s.code?.toLowerCase() === q);
}

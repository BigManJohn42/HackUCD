// Look up stops in the static timetable.
//   npm run stops -- connolly
import { loadGtfs, searchStops } from "../src/gtfs.js";

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.error("Usage: npm run stops -- <name or stop code>");
  process.exit(1);
}

const { stops, routes, trips } = await loadGtfs();
console.log(`Loaded ${stops.size} stops, ${routes.size} routes, ${trips.size} trips\n`);

const matches = searchStops(stops, query);
if (!matches.length) console.log(`No stops match "${query}".`);
else console.table(matches.slice(0, 25).map((s) => ({ stop_id: s.id, code: s.code, name: s.name, lat: s.lat, lon: s.lon })));
if (matches.length > 25) console.log(`...and ${matches.length - 25} more`);

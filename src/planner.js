// A -> B journey planner over the static timetable (buses, rail, Luas), with optional
// stopovers: "go to Athlone, stay 2 hours, then continue to Galway".
//
// Uses the Connection Scan Algorithm: every hop of every trip running that day is a
// "connection" (from stop, to stop, depart, arrive), sorted by departure time. Scanning
// them once in order gives the earliest arrival at every stop.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, activeServices, findStops, irishNow } from "./timetable.js";

const CACHE_DIR = path.join(path.dirname(DB_PATH), "cache");
const WALK_RADIUS_M = 500; // max walk to/from a stop, and between stops when changing
const WALK_SECS_PER_M = 1.0; // ~1.25 m/s with a 1.25 detour factor
const CHANGE_SECS = 90; // minimum time to change between vehicles at the same stop

let db;
const openDb = () => (db ??= new DatabaseSync(DB_PATH, { readOnly: true }));

const shiftDate = (yyyymmdd, days) => {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + days));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
};

function distanceM(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * 111_320;
}

// ---------- network: stops + walking transfers (same for every day) ----------

let stopsCache;
function loadStops() {
  if (stopsCache) return stopsCache;
  const rows = openDb().prepare("SELECT stop_id, stop_code, stop_name, lat, lon FROM stops ORDER BY rowid").all();
  const index = new Map(rows.map((s, i) => [s.stop_id, i]));

  // Walking transfers between stops within WALK_RADIUS_M, via a grid so it's not O(n^2).
  const cell = WALK_RADIUS_M / 111_320;
  const key = (lat, lon) => `${Math.floor(lat / cell)},${Math.floor(lon / (cell * 1.7))}`; // 1.7 ~ 1/cos(53°)
  const grid = new Map();
  rows.forEach((s, i) => {
    const k = key(s.lat, s.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const footpaths = rows.map(() => []);
  rows.forEach((s, i) => {
    const [gy, gx] = key(s.lat, s.lon).split(",").map(Number);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const j of grid.get(`${gy + dy},${gx + dx}`) ?? []) {
          if (j === i) continue;
          const d = distanceM(s.lat, s.lon, rows[j].lat, rows[j].lon);
          if (d <= WALK_RADIUS_M) footpaths[i].push([j, Math.round(d * WALK_SECS_PER_M)]);
        }
  });
  return (stopsCache = { stops: rows, index, footpaths });
}

/** Stops within walking distance of a point, as [{ stop, secs }]. */
function stopsNear(lat, lon) {
  const { stops } = loadStops();
  const out = [];
  stops.forEach((s, i) => {
    const d = distanceM(lat, lon, s.lat, s.lon);
    if (d <= WALK_RADIUS_M) out.push({ stop: i, secs: Math.round(d * WALK_SECS_PER_M) });
  });
  return out;
}

/** How well a query names a stop: 0 exact, 1 prefix, 2 contains, Infinity no match. */
export function matchQuality(query) {
  const q = query.trim().toLowerCase();
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q)) return 0;
  const matches = findStops(q);
  if (!matches.length) {
    // resolvePlace can still fall back to single words ("dublin airport" -> "airport")
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    return words.length > 1 && words.some((w) => findStops(w).length) ? 3 : Infinity;
  }
  const names = matches.map((s) => s.stop_name.toLowerCase());
  if (names.includes(q) || matches.some((s) => s.stop_code === q)) return 0;
  return names.some((n) => n.startsWith(q)) ? 1 : 2;
}

/** Resolve "UCD", a stop number, or "53.30,-6.22" to a place with nearby stops. */
export function resolvePlace(query) {
  const coords = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) {
    const [lat, lon] = [Number(coords[1]), Number(coords[2])];
    return { name: `${lat}, ${lon}`, lat, lon, near: stopsNear(lat, lon) };
  }
  let matches = findStops(query);
  if (!matches.length) {
    // Fall back to word matching: stops containing every word, else the most specific single
    // word that matches anything ("dublin airport" -> "airport" -> "Airport Zone 11").
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const perWord = words.map((w) => findStops(w));
    matches = perWord[0]?.filter((s) => words.every((w) => s.stop_name.toLowerCase().includes(w))) ?? [];
    if (!matches.length) {
      // Skip city/generic words when picking the single word ("dublin airport" -> "airport").
      const generic = new Set(["dublin", "cork", "galway", "limerick", "waterford", "city", "county", "the", "street", "road", "station"]);
      const useful = words.map((w, i) => [w, perWord[i]]).filter(([w, m]) => m.length && !generic.has(w));
      const pick = (useful.length ? useful : words.map((w, i) => [w, perWord[i]]).filter(([, m]) => m.length))
        .sort((a, b) => a[1].length - b[1].length)[0];
      matches = pick?.[1] ?? [];
    }
  }
  if (!matches.length) throw new Error(`No stop or place matches "${query}"`);
  // Rank: exact name / stop number, then names starting with the query, then the rest.
  // Within a tier prefer train stations, then the busiest stop - so "galway" finds
  // Galway (Ceannt) station rather than "Galway SC".
  const q = query.trim().toLowerCase();
  const tier = (s) => (s.stop_name.toLowerCase() === q || s.stop_code === query.trim() ? 0 : s.stop_name.toLowerCase().startsWith(q) ? 1 : 2);
  const count = openDb().prepare("SELECT count(*) AS n FROM stop_times WHERE stop_id = ?");
  const isRail = openDb().prepare(`
    SELECT 1 FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id JOIN routes r ON r.route_id = t.route_id
    WHERE st.stop_id = ? AND r.route_type = 2 LIMIT 1`);
  const match = matches.slice(0, 40)
    .map((s) => ({ s, tier: tier(s), rail: isRail.get(s.stop_id) ? 1 : 0, n: count.get(s.stop_id).n }))
    .sort((a, b) => a.tier - b.tier || b.rail - a.rail || b.n - a.n)[0].s;
  // The place is every stop near the best match, plus every other matching stop within
  // 2 km of it (so "airport" ends at whichever Airport stop you reach first).
  const near = stopsNear(match.lat, match.lon);
  const { index } = loadStops();
  const have = new Set(near.map((n) => n.stop));
  for (const s of matches) {
    const i = index.get(s.stop_id);
    if (!have.has(i) && distanceM(match.lat, match.lon, s.lat, s.lon) <= 2000) {
      near.push({ stop: i, secs: 0 });
      have.add(i);
    }
  }
  return { name: match.stop_name, lat: match.lat, lon: match.lon, near };
}

// ---------- connections for one service day (cached on disk) ----------

class IntList {
  constructor() { this.a = new Int32Array(1 << 20); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  get array() { return this.a.subarray(0, this.n); }
}

function buildConnections(date) {
  const { index } = loadStops();
  const d = openDb();
  const today = activeServices(date);
  const yesterday = activeServices(shiftDate(date, -1));
  const tripService = new Map(d.prepare("SELECT trip_id, service_id FROM trips").all().map((r) => [r.trip_id, r.service_id]));

  const dep = new IntList(), arr = new IntList(), from = new IntList(), to = new IntList(), trip = new IntList();
  const tripIds = []; // index -> trip_id (suffixed "@-1" when it's yesterday's service running past midnight)

  const stmt = d.prepare("SELECT trip_id, stop_id, arrival, departure FROM stop_times ORDER BY rowid");
  stmt.setReturnArrays(true);
  let cur = null, runsToday = false, runsYesterday = false, todayIdx = -1, yIdx = -1;
  let prevStop = -1, prevDep = 0;
  for (const [tripId, stopId, arrival, departure] of stmt.iterate()) {
    if (tripId !== cur) {
      cur = tripId;
      const svc = tripService.get(tripId);
      runsToday = today.has(svc);
      runsYesterday = yesterday.has(svc);
      todayIdx = runsToday ? tripIds.push(tripId) - 1 : -1;
      yIdx = runsYesterday ? tripIds.push(`${tripId}@-1`) - 1 : -1;
      prevStop = -1;
    }
    const stop = index.get(stopId);
    if (prevStop >= 0) {
      if (runsToday) { dep.push(prevDep); arr.push(arrival); from.push(prevStop); to.push(stop); trip.push(todayIdx); }
      if (runsYesterday && prevDep >= 86400) {
        dep.push(prevDep - 86400); arr.push(arrival - 86400); from.push(prevStop); to.push(stop); trip.push(yIdx);
      }
    }
    prevStop = stop;
    prevDep = departure;
  }

  // Sort all connections by departure time.
  const n = dep.n;
  const order = new Uint32Array(n).map((_, i) => i).sort((a, b) => dep.a[a] - dep.a[b]);
  const packed = new Int32Array(n * 5);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    packed[k] = dep.a[i]; packed[n + k] = arr.a[i]; packed[2 * n + k] = from.a[i];
    packed[3 * n + k] = to.a[i]; packed[4 * n + k] = trip.a[i];
  }
  return { n, packed, tripIds };
}

const loaded = new Map(); // date -> connections

/** Connections for a service date (YYYYMMDD). Built once per day (~1 min), then read from data/cache. */
export function getConnections(date, { log = () => {} } = {}) {
  if (loaded.has(date)) return loaded.get(date);
  const dbStamp = String(fs.statSync(DB_PATH).mtimeMs);
  const bin = path.join(CACHE_DIR, `connections-${date}.bin`);
  const meta = path.join(CACHE_DIR, `connections-${date}.json`);

  let c;
  if (fs.existsSync(bin) && fs.existsSync(meta) && JSON.parse(fs.readFileSync(meta, "utf8")).dbStamp === dbStamp) {
    const { n, tripIds } = JSON.parse(fs.readFileSync(meta, "utf8"));
    const buf = fs.readFileSync(bin);
    c = { n, tripIds, packed: new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
  } else {
    log(`Building timetable for ${date} (first run today, takes about a minute)...`);
    c = buildConnections(date);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    for (const f of fs.readdirSync(CACHE_DIR)) if (f.startsWith("connections-")) fs.rmSync(path.join(CACHE_DIR, f));
    fs.writeFileSync(bin, Buffer.from(c.packed.buffer, c.packed.byteOffset, c.packed.byteLength));
    fs.writeFileSync(meta, JSON.stringify({ n: c.n, tripIds: c.tripIds, dbStamp }));
  }
  const { n, packed } = c;
  const conns = {
    n,
    tripIds: c.tripIds,
    dep: packed.subarray(0, n), arr: packed.subarray(n, 2 * n), from: packed.subarray(2 * n, 3 * n),
    to: packed.subarray(3 * n, 4 * n), trip: packed.subarray(4 * n, 5 * n),
  };
  loaded.set(date, conns);
  return conns;
}

// ---------- the search ----------

/**
 * Earliest arrival from `origins` ([{ stop, secs }]) to `targets` ([{ stop, secs }]),
 * leaving no earlier than `departSecs`. Returns legs, or null if unreachable today.
 */
function earliestArrival(c, origins, targets, departSecs) {
  const { footpaths } = loadStops();
  const nStops = footpaths.length;
  const arrival = new Float64Array(nStops).fill(Infinity);
  const ready = new Float64Array(nStops).fill(Infinity); // earliest time we could board something here
  const kind = new Int8Array(nStops); // 1 origin, 2 ride, 3 walk
  const pa = new Int32Array(nStops); // origin: walk secs | ride: boarding connection | walk: from stop
  const pb = new Int32Array(nStops); // ride: alighting connection | walk: secs
  const tripBoard = new Int32Array(c.tripIds.length).fill(-1);
  const targetWalk = new Map(targets.map((t) => [t.stop, t.secs]));
  let best = Infinity, bestStop = -1;

  const reach = (s, t, k, a, b, readyAt) => {
    arrival[s] = t; ready[s] = readyAt; kind[s] = k; pa[s] = a; pb[s] = b;
    const w = targetWalk.get(s);
    if (w !== undefined && t + w < best) { best = t + w; bestStop = s; }
  };
  for (const o of origins) {
    const t = departSecs + o.secs;
    if (t < arrival[o.stop]) reach(o.stop, t, 1, o.secs, 0, t);
  }

  // Binary search for the first connection departing at/after departSecs.
  let lo = 0, hi = c.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c.dep[mid] < departSecs) lo = mid + 1; else hi = mid; }

  for (let i = lo; i < c.n; i++) {
    const dep = c.dep[i];
    if (dep > best) break;
    const t = c.trip[i];
    if (tripBoard[t] < 0) {
      if (ready[c.from[i]] > dep) continue;
      tripBoard[t] = i;
    }
    const s = c.to[i], a = c.arr[i];
    if (a < arrival[s]) {
      reach(s, a, 2, tripBoard[t], i, a + CHANGE_SECS);
      for (const [f, w] of footpaths[s]) if (a + w < arrival[f]) reach(f, a + w, 3, s, w, a + w);
    }
  }
  if (bestStop < 0) return null;

  // Walk the parent pointers back from the destination.
  const legs = [];
  let s = bestStop;
  while (kind[s] !== 1) {
    if (kind[s] === 2) {
      const b = pa[s], e = pb[s];
      legs.unshift({ type: "ride", trip: c.tripIds[c.trip[e]], fromStop: c.from[b], toStop: s, depart: c.dep[b], arrive: c.arr[e] });
      s = c.from[b];
    } else {
      legs.unshift({ type: "walk", fromStop: pa[s], toStop: s, secs: pb[s], arrive: arrival[s] });
      s = pa[s];
    }
  }
  return { originStop: s, originWalk: pa[s], destStop: bestStop, destWalk: targetWalk.get(bestStop), arrive: best, legs };
}

function describeTrips(tripIds) {
  const stmt = openDb().prepare(`
    SELECT t.headsign, r.short_name, r.long_name, r.route_type
    FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE t.trip_id = ?`);
  const out = new Map();
  for (const id of tripIds) out.set(id, stmt.get(id.replace(/@-1$/, "")));
  return out;
}

const MODES = { 0: "Luas", 2: "Train", 3: "Bus" };

/**
 * Plan a journey from -> [vias...] -> to, staying `stayMins` at each via.
 * depart: "HH:MM" (default now), date: "YYYY-MM-DD" (default today).
 * Returns { segments: [{ from, to, leaveAt, arriveAt, legs }], stays, arriveAt } with times in seconds since midnight.
 */
export function planJourney({ from, to, vias = [], stayMins = 120, depart, date, log } = {}) {
  const now = irishNow();
  const serviceDate = date ? date.replaceAll("-", "") : now.date;
  let t = now.secs;
  if (depart) {
    const m = depart.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error(`--depart must be HH:MM, got "${depart}"`);
    t = Number(m[1]) * 3600 + Number(m[2]) * 60;
  }

  const c = getConnections(serviceDate, { log });
  const { stops } = loadStops();
  const places = [from, ...vias, to].map(resolvePlace);
  for (const p of places) if (!p.near.length) throw new Error(`No stops within ${WALK_RADIUS_M} m of ${p.name}`);

  const segments = [];
  for (let k = 0; k < places.length - 1; k++) {
    const a = places[k], b = places[k + 1];
    let result = earliestArrival(c, a.near, b.near, t);
    if (!result) return { ok: false, error: `No connection from ${a.name} to ${b.name} after ${fmt(t)} on this day`, segments };
    // Leave as late as possible while still arriving at the same time: avoids pointless
    // early departures and detours (e.g. riding back a stop to catch a train that comes past anyway).
    let lo = t, hi = result.arrive;
    while (hi - lo > 60) {
      const mid = Math.floor((lo + hi) / 2);
      const r = earliestArrival(c, a.near, b.near, mid);
      if (r && r.arrive <= result.arrive) { lo = mid; result = r; } else hi = mid;
    }

    const trips = describeTrips(result.legs.filter((l) => l.type === "ride").map((l) => l.trip));
    const legs = result.legs.map((l) => {
      const base = { ...l, fromName: stops[l.fromStop].stop_name, toName: stops[l.toStop].stop_name,
        fromCode: stops[l.fromStop].stop_code, toCode: stops[l.toStop].stop_code };
      if (l.type !== "ride") return base;
      const info = trips.get(l.trip) ?? {};
      const route = info.short_name && info.short_name !== "rail" ? info.short_name : info.long_name ?? "?";
      return { ...base, mode: MODES[info.route_type] ?? "Transit", route, headsign: info.headsign ?? null };
    });
    const firstRide = legs.find((l) => l.type === "ride");
    const leaveAt = (firstRide ? firstRide.depart : t) - result.originWalk;
    segments.push({
      from: a.name, to: b.name, leaveAt, arriveAt: result.arrive,
      originWalk: { secs: result.originWalk, toName: stops[result.originStop].stop_name },
      destWalk: { secs: result.destWalk, fromName: stops[result.destStop].stop_name },
      legs,
    });
    t = result.arrive + (k < places.length - 2 ? stayMins * 60 : 0);
  }
  return {
    ok: true,
    date: serviceDate,
    stayMins: vias.length ? stayMins : 0,
    segments,
    leaveAt: segments[0].leaveAt,
    arriveAt: segments.at(-1).arriveAt,
  };
}

/** "HH:MM" from seconds since midnight (wraps past 24:00). */
export function fmt(secs) {
  const s = Math.round(secs);
  const h = Math.floor(s / 3600) % 24, m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Client for the NTA (Transport for Ireland) GTFS-Realtime API.
// Docs / API key: https://developer.nationaltransport.ie
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

const BASE_URL = process.env.NTA_BASE_URL ?? "https://api.nationaltransport.ie/gtfsr/v2";

// NTA's fair-usage policy allows each key ONE call every 60 seconds, across all feeds.
// The CLI scripts and the UI server are separate processes, so responses and the time
// of the last call are shared through files in data/cache/.
const MIN_INTERVAL_MS = 61_000;
const STALE_OK_MS = 15 * 60_000; // serve saved data up to this old when we can't call
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "cache");
const LAST_CALL = path.join(CACHE_DIR, "nta-last-call");
const feedFile = (feed) => path.join(CACHE_DIR, `nta-${feed}.pb`);

const memory = new Map(); // feed -> { at, data }
const inflight = new Map(); // feed -> promise, so concurrent callers share one request

const ageMs = (file) => (fs.existsSync(file) ? Date.now() - fs.statSync(file).mtimeMs : Infinity);
const decode = (buf) => FeedMessage.toObject(FeedMessage.decode(buf), { longs: Number, enums: String });

function readSaved(feed, maxAge) {
  const file = feedFile(feed);
  if (ageMs(file) > maxAge) return null;
  const mem = memory.get(feed);
  const at = fs.statSync(file).mtimeMs;
  if (mem?.at === at) return mem.data;
  const data = decode(new Uint8Array(fs.readFileSync(file)));
  memory.set(feed, { at, data });
  return data;
}

async function callApi(feed) {
  const apiKey = process.env.NTA_API_KEY?.trim();
  if (!apiKey) throw new Error("NTA_API_KEY is not set (put it in .env)");

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(LAST_CALL, feed); // claim the slot before calling, so other processes back off
  const res = await fetch(`${BASE_URL}/${feed}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`NTA ${feed} request failed: ${res.status} ${res.statusText}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const data = decode(buf);
  fs.writeFileSync(feedFile(feed), buf);
  memory.set(feed, { at: fs.statSync(feedFile(feed)).mtimeMs, data });
  return data;
}

async function getFeed(feed) {
  // Fresh enough already (fetched by us or another process within the last minute)?
  const fresh = readSaved(feed, MIN_INTERVAL_MS);
  if (fresh) return fresh;

  // Someone used this key's one call in the last minute: serve saved data if we have any.
  const waitMs = MIN_INTERVAL_MS - ageMs(LAST_CALL);
  if (waitMs > 0) {
    const saved = readSaved(feed, STALE_OK_MS);
    if (saved) return saved;
    throw new Error(`NTA rate limit (1 call/min per key): try again in ${Math.ceil(waitMs / 1000)}s`);
  }

  if (!inflight.has(feed)) {
    inflight.set(feed, callApi(feed).finally(() => inflight.delete(feed)));
  }
  try {
    return await inflight.get(feed);
  } catch (err) {
    const saved = readSaved(feed, STALE_OK_MS); // e.g. a 429: fall back to the last good copy
    if (saved) return saved;
    throw err;
  }
}

/**
 * Live delays/cancellations, flattened to one row per stop on each trip.
 * delay is in seconds (positive = late). Times are unix seconds when provided.
 */
export async function getTripUpdates() {
  const feed = await getFeed("TripUpdates");
  const rows = [];

  for (const { tripUpdate } of feed.entity ?? []) {
    if (!tripUpdate) continue;
    const { trip } = tripUpdate;
    const base = {
      tripId: trip.tripId,
      routeId: trip.routeId,
      startTime: trip.startTime,
      startDate: trip.startDate,
      tripStatus: trip.scheduleRelationship ?? "SCHEDULED", // e.g. CANCELED, ADDED
    };

    if (!tripUpdate.stopTimeUpdate?.length) {
      rows.push({ ...base, stopId: null, stopSequence: null, delay: null });
      continue;
    }
    for (const stu of tripUpdate.stopTimeUpdate) {
      const event = stu.departure ?? stu.arrival ?? {};
      rows.push({
        ...base,
        stopId: stu.stopId ?? null,
        stopSequence: stu.stopSequence ?? null,
        stopStatus: stu.scheduleRelationship ?? "SCHEDULED", // e.g. SKIPPED
        delay: event.delay ?? null,
        time: event.time ?? null,
      });
    }
  }
  return { timestamp: feed.header?.timestamp ?? null, rows };
}

/** Live vehicle positions. */
export async function getVehiclePositions() {
  const feed = await getFeed("Vehicles");
  const vehicles = [];

  for (const { vehicle } of feed.entity ?? []) {
    if (!vehicle?.position) continue;
    vehicles.push({
      vehicleId: vehicle.vehicle?.id ?? null,
      tripId: vehicle.trip?.tripId ?? null,
      routeId: vehicle.trip?.routeId ?? null,
      lat: vehicle.position.latitude,
      lon: vehicle.position.longitude,
      timestamp: vehicle.timestamp ?? null,
    });
  }
  return { timestamp: feed.header?.timestamp ?? null, vehicles };
}

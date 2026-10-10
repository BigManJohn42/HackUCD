// Client for the NTA (Transport for Ireland) GTFS-Realtime API.
// Docs / API key: https://developer.nationaltransport.ie
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

const BASE_URL = process.env.NTA_BASE_URL ?? "https://api.nationaltransport.ie/gtfsr/v2";

// The API is rate-limited, so cache each feed briefly and share it between callers.
const CACHE_MS = Number(process.env.NTA_CACHE_MS ?? 60_000);
const cache = new Map(); // feed name -> { at, promise }

async function fetchFeed(feed) {
  const apiKey = process.env.NTA_API_KEY;
  if (!apiKey) throw new Error("NTA_API_KEY is not set (put it in .env)");

  const res = await fetch(`${BASE_URL}/${feed}`, { headers: { "x-api-key": apiKey } });
  if (!res.ok) {
    throw new Error(`NTA ${feed} request failed: ${res.status} ${res.statusText}`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  return FeedMessage.toObject(FeedMessage.decode(buffer), { longs: Number, enums: String });
}

function getFeed(feed) {
  const hit = cache.get(feed);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;

  const promise = fetchFeed(feed);
  cache.set(feed, { at: Date.now(), promise });
  promise.catch(() => cache.delete(feed)); // don't cache failures
  return promise;
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

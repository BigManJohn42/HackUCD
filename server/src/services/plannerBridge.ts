import { findStops, irishNow, scheduledDepartures } from "../../../src/timetable.js";
import { planJourney, resolvePlace } from "../../../src/planner.js";
import { getTripUpdates } from "../../../src/nta.js";
import type { Corridor, Leg, LiveStatus, Mode, RouteOption } from "../types.js";

// Bridges the real Connection Scan journey planner (repo root `src/planner.js`,
// built from the downloaded NTA GTFS timetable) into our existing Corridor/Leg
// shape, so a real A->B search renders through the exact same editable-leg UI,
// map and break panel as the hardcoded sample corridor. Real plans only ever
// have one option per leg (the planner returns one best route, not
// alternatives), unlike the sample corridor's curated 2-3 choices per leg.
// Each ride carries its planned board/alight times and stop numbers, the
// route's later departures, and live status from NTA GTFS-Realtime when available.

const REAL_MODE: Record<string, Mode> = { Bus: "bus", Luas: "luas", Train: "rail" };

function estimateCost(mode: Mode): number {
  if (mode === "walk" || mode === "cycle" || mode === "stay") return 0;
  if (mode === "luas") return 2.3;
  return 2.0;
}

function estimateCo2(mode: Mode): number {
  if (mode === "walk" || mode === "cycle" || mode === "stay") return 0;
  if (mode === "luas") return 0.1;
  return 0.4;
}

interface PlannerLeg {
  type: "walk" | "ride";
  trip?: string;
  fromStop: number;
  toStop: number;
  fromName: string;
  toName: string;
  fromCode: string | null;
  toCode: string | null;
  depart?: number;
  arrive: number;
  secs?: number; // walk legs
  mode?: "Bus" | "Luas" | "Train" | "Transit";
  route?: string;
  headsign?: string | null;
}

interface PlannerSegment {
  from: string;
  to: string;
  leaveAt: number;
  arriveAt: number;
  originWalk: { secs: number; toName: string };
  destWalk: { secs: number; fromName: string };
  legs: PlannerLeg[];
}

interface TripUpdateRow {
  tripId: string;
  stopId: string | null;
  stopSequence: number | null;
  tripStatus: string;
  stopStatus?: string;
  delay: number | null;
}

const stopCoordCache = new Map<string, [number, number]>();

function coordsForCode(code: string | null): [number, number] | null {
  if (!code) return null;
  if (stopCoordCache.has(code)) return stopCoordCache.get(code)!;
  const [row] = findStops(code);
  if (!row) return null;
  const coords: [number, number] = [row.lat, row.lon];
  stopCoordCache.set(code, coords);
  return coords;
}

/** "HH:MM", with "(+1 day)" past the start day's midnight. */
function fmtTime(secs: number): string {
  const s = Math.round(secs);
  const days = Math.floor(s / 86400);
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}${days > 0 ? " (+1 day)" : ""}`;
}

const minutes = (secs: number) => Math.max(1, Math.round(secs / 60));

/** Live delay for a trip at its boarding stop, from the GTFS-R rows for that trip. */
function liveStatusFor(updates: TripUpdateRow[] | undefined, stopId: string | undefined): LiveStatus {
  if (!updates) return { status: "scheduled" };
  if (updates.some((u) => u.tripStatus === "CANCELED")) return { status: "cancelled" };
  // Use the update for our stop, else the latest one before it (delays carry forward).
  const here = updates.find((u) => u.stopId === stopId) ?? updates.filter((u) => u.delay != null).at(-1);
  if (here?.stopStatus === "SKIPPED") return { status: "skipped" };
  const delayMin = Math.round((here?.delay ?? 0) / 60);
  if (delayMin > 0) return { status: "late", delayMin };
  if (delayMin < 0) return { status: "early", delayMin };
  return { status: "on-time", delayMin: 0 };
}

/** Later departures of the same route from the boarding stop, after the planned one. */
function laterDeparturesFor(leg: PlannerLeg, stopId: string | undefined): string[] {
  if (!stopId || leg.depart === undefined) return [];
  try {
    // scheduledDepartures works from a wall-clock instant; shift "now" to the planned departure.
    const at = new Date(Date.now() + (leg.depart + 60 - irishNow().secs) * 1000);
    return scheduledDepartures([stopId], { windowMins: 90, at })
      .filter((d) => d.trip_id !== leg.trip?.replace(/@-1$/, "") && (d.short_name ?? d.long_name) === leg.route)
      .map((d) => fmtTime(d.departure))
      .filter((t, i, all) => all.indexOf(t) === i)
      .slice(0, 3);
  } catch {
    return [];
  }
}

function walkOption(id: string, toName: string, secs: number): RouteOption {
  return {
    id,
    mode: "walk",
    label: `Walk to ${toName}`,
    durationMin: minutes(secs),
    departures: [],
    costEuro: 0,
    co2Kg: 0,
  };
}

function rideOption(leg: PlannerLeg, id: string, live: Map<string, TripUpdateRow[]> | null): RouteOption {
  const mode: Mode = REAL_MODE[leg.mode ?? "Transit"] ?? "bus";
  const stopId = leg.fromCode ? findStops(leg.fromCode)[0]?.stop_id : undefined;
  const tripId = leg.trip?.replace(/@-1$/, "");
  const depart = leg.depart ?? leg.arrive;
  return {
    id,
    mode,
    label: `${leg.mode === "Luas" ? `Luas ${leg.route} line` : leg.mode === "Bus" ? `Bus ${leg.route}` : `Train ${leg.route ?? ""}`.trim()} towards ${leg.headsign ?? leg.toName}`,
    durationMin: minutes(leg.arrive - depart),
    departures: [fmtTime(depart)],
    costEuro: estimateCost(mode),
    co2Kg: estimateCo2(mode),
    boardAt: fmtTime(depart),
    arriveAt: fmtTime(leg.arrive),
    fromStopCode: leg.fromCode,
    toStopCode: leg.toCode,
    laterDepartures: laterDeparturesFor(leg, stopId),
    live: live && tripId ? liveStatusFor(live.get(tripId), stopId) : undefined,
  };
}

/** Live trip updates keyed by trip, or null when NTA isn't configured / rate-limited with no saved copy. */
async function loadLive(): Promise<Map<string, TripUpdateRow[]> | null> {
  if (!process.env.NTA_API_KEY) return null;
  try {
    const { rows } = (await getTripUpdates()) as { rows: TripUpdateRow[] };
    const byTrip = new Map<string, TripUpdateRow[]>();
    for (const r of rows) {
      if (!byTrip.has(r.tripId)) byTrip.set(r.tripId, []);
      byTrip.get(r.tripId)!.push(r);
    }
    return byTrip;
  } catch (err) {
    console.warn("[plan] live data unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface RealJourneyOptions {
  depart?: string; // "HH:MM"
  vias?: string[];
  stayMins?: number;
}

export async function planRealJourney(
  from: string,
  to: string,
  { depart, vias = [], stayMins = 120 }: RealJourneyOptions = {}
): Promise<{ ok: true; corridor: Corridor } | { ok: false; error: string }> {
  // planner.js is untyped JS, so describe the result shape we rely on.
  let result: { ok: boolean; error?: string; segments: unknown[]; leaveAt: number; arriveAt: number };
  try {
    const plan = planJourney as unknown as (opts: Record<string, unknown>) => typeof result;
    result = plan({ from, to, depart, vias, stayMins });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not plan that journey." };
  }
  if (!result.ok) return { ok: false, error: result.error ?? "No route found." };

  const live = await loadLive();
  const legs: Leg[] = [];
  const stopCoords: Record<string, [number, number]> = {};
  let optionCount = 0;
  const nextId = () => `real-leg-${optionCount++}`;

  const addCoord = (name: string, code: string | null) => {
    if (stopCoords[name]) return;
    const coords = coordsForCode(code);
    if (coords) stopCoords[name] = coords;
  };

  // The places the user typed are their own points (not exactly any one stop),
  // so get their coordinates directly rather than approximating from a nearby stop.
  for (const q of [from, ...vias, to]) {
    try {
      const place = resolvePlace(q);
      stopCoords[place.name] = [place.lat, place.lon];
    } catch {
      /* fall back to stop-based coords below */
    }
  }

  const segments = result.segments as PlannerSegment[];
  segments.forEach((segment, segIndex) => {
    // originWalk/destWalk (door <-> stop) live outside `legs`, so splice them
    // in as their own walk legs - otherwise the itinerary would start and end
    // mid-journey at the first/last stop instead of the place the user typed.
    if (segment.originWalk.secs > 60 && segment.originWalk.toName !== segment.from) {
      legs.push({
        id: `leg-${segIndex}-origin-walk`,
        from: segment.from,
        to: segment.originWalk.toName,
        isTransferPoint: false,
        options: [walkOption(nextId(), segment.originWalk.toName, segment.originWalk.secs)],
      });
    }

    segment.legs
      .filter((l) => l.type === "ride" || l.fromName !== l.toName)
      .forEach((leg, legIndex) => {
        legs.push({
          id: `leg-${segIndex}-${legIndex}`,
          from: leg.fromName,
          to: leg.toName,
          isTransferPoint: leg.type === "ride",
          options: [leg.type === "ride" ? rideOption(leg, nextId(), live) : walkOption(nextId(), leg.toName, leg.secs ?? 60)],
        });
        addCoord(leg.fromName, leg.fromCode);
        addCoord(leg.toName, leg.toCode);
      });

    if (segment.destWalk.secs > 60 && segment.destWalk.fromName !== segment.to) {
      legs.push({
        id: `leg-${segIndex}-dest-walk`,
        from: segment.destWalk.fromName,
        to: segment.to,
        isTransferPoint: false,
        options: [walkOption(nextId(), segment.to, segment.destWalk.secs)],
      });
    }

    // The stopover itself, between this segment and the next.
    if (segIndex < segments.length - 1) {
      const next = segments[segIndex + 1];
      legs.push({
        id: `leg-${segIndex}-stopover`,
        from: segment.to,
        to: segment.to,
        isTransferPoint: true, // lets the user ask the concierge what to do during the stay
        options: [
          {
            id: nextId(),
            mode: "stay",
            label: `Stopover in ${segment.to}`,
            durationMin: minutes(next.leaveAt - segment.arriveAt),
            departures: [],
            costEuro: 0,
            co2Kg: 0,
            boardAt: fmtTime(segment.arriveAt),
            arriveAt: fmtTime(next.leaveAt),
            notes: `You asked for ${stayMins} min; the next connection leaves at ${fmtTime(next.leaveAt)}`,
          },
        ],
      });
    }
  });

  if (legs.length === 0) {
    return { ok: false, error: "That journey is too short to break into steps - try two different places." };
  }
  legs[legs.length - 1].isTransferPoint = false;

  const corridor: Corridor = {
    id: `real-${[from, ...vias, to].join("-")}`.toLowerCase().replace(/\s+/g, "-"),
    name: [segments[0].from, ...segments.map((s) => s.to)].join(" -> "),
    legs,
    stopCoords,
    summary: {
      leaveAt: fmtTime(result.leaveAt),
      arriveAt: fmtTime(result.arriveAt),
      durationMin: minutes(result.arriveAt - result.leaveAt),
      liveData: live !== null,
    },
  };

  return { ok: true, corridor };
}

import { findStops, scheduledDepartures } from "../../../src/timetable.js";
import { planJourney, resolvePlace } from "../../../src/planner.js";
import type { Corridor, Leg, Mode, RouteOption } from "../types.js";

// Bridges the real Connection Scan journey planner (repo root `src/planner.js`,
// built from the downloaded NTA GTFS timetable) into our existing Corridor/Leg
// shape, so a real A->B search renders through the exact same editable-leg UI,
// map and break panel as the hardcoded sample corridor. Real plans only ever
// have one option per leg (the planner returns one best route, not
// alternatives), unlike the sample corridor's curated 2-3 choices per leg.

const REAL_MODE: Record<string, Mode> = { Bus: "bus", Luas: "luas", Train: "rail" };

function estimateCost(mode: Mode): number {
  if (mode === "walk" || mode === "cycle") return 0;
  if (mode === "luas") return 2.3;
  return 2.0;
}

function estimateCo2(mode: Mode): number {
  if (mode === "walk" || mode === "cycle") return 0;
  if (mode === "luas") return 0.1;
  return 0.4;
}

interface PlannerLeg {
  type: "walk" | "ride";
  fromStop: number;
  toStop: number;
  fromName: string;
  toName: string;
  fromCode: string;
  toCode: string;
  depart?: number;
  arrive?: number;
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

const stopCoordCache = new Map<string, [number, number]>();

function coordsForCode(code: string): [number, number] | null {
  if (stopCoordCache.has(code)) return stopCoordCache.get(code)!;
  const [row] = findStops(code);
  if (!row) return null;
  const coords: [number, number] = [row.lat, row.lon];
  stopCoordCache.set(code, coords);
  return coords;
}

function fmtMin(secs: number): string {
  const s = Math.round(secs);
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toOption(leg: PlannerLeg, index: number): RouteOption {
  const mode: Mode = leg.type === "walk" ? "walk" : REAL_MODE[leg.mode ?? "Transit"] ?? "bus";
  const durationMin = Math.max(1, Math.round(((leg.arrive ?? 0) - (leg.depart ?? 0)) / 60));
  const label =
    mode === "walk"
      ? `Walk to ${leg.toName}`
      : `${leg.route ?? leg.mode} towards ${leg.headsign ?? leg.toName}`;

  let departures: string[] = [];
  if (leg.depart !== undefined) {
    departures = [fmtMin(leg.depart)];
    const stopId = findStops(leg.fromCode)[0]?.stop_id;
    if (stopId) {
      try {
        const upcoming = scheduledDeparturesForStop(stopId);
        if (upcoming.length) departures = upcoming;
      } catch {
        // Keep the single planned departure if the live timetable lookup fails.
      }
    }
  }

  return {
    id: `real-leg-${index}`,
    mode,
    label,
    durationMin,
    departures,
    costEuro: estimateCost(mode),
    co2Kg: estimateCo2(mode),
    notes: mode !== "walk" && leg.headsign ? `Towards ${leg.headsign}` : undefined,
  };
}

function scheduledDeparturesForStop(stopId: string): string[] {
  return scheduledDepartures([stopId], { windowMins: 90 })
    .slice(0, 4)
    .map((d) => fmtMin(d.departure));
}

export function planRealJourney(
  from: string,
  to: string,
  depart?: string
): { ok: true; corridor: Corridor } | { ok: false; error: string } {
  let result: ReturnType<typeof planJourney>;
  try {
    result = planJourney({ from, to, depart });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not plan that journey." };
  }
  if (!result.ok) return { ok: false, error: result.error ?? "No route found." };

  const legs: Leg[] = [];
  const stopCoords: Record<string, [number, number]> = {};

  const addCoord = (name: string, code: string) => {
    if (stopCoords[name]) return;
    const coords = coordsForCode(code);
    if (coords) stopCoords[name] = coords;
  };

  // The resolved endpoint place is its own point (not exactly any one stop),
  // so get its coordinates directly rather than approximating from a nearby stop.
  try {
    const fromPlace = resolvePlace(from);
    stopCoords[fromPlace.name] = [fromPlace.lat, fromPlace.lon];
  } catch {
    /* fall back to stop-based coords below if this fails */
  }
  try {
    const toPlace = resolvePlace(to);
    stopCoords[toPlace.name] = [toPlace.lat, toPlace.lon];
  } catch {
    /* fall back to stop-based coords below if this fails */
  }

  (result.segments as PlannerSegment[]).forEach((segment, segIndex) => {
    // originWalk/destWalk (door <-> stop) live outside `legs`, so splice them
    // in as their own walk legs - otherwise the itinerary would start and end
    // mid-journey at the first/last stop instead of the place the user typed.
    if (segment.originWalk.secs > 0 && segment.originWalk.toName !== segment.from) {
      legs.push({
        id: `leg-${segIndex}-origin-walk`,
        from: segment.from,
        to: segment.originWalk.toName,
        isTransferPoint: true,
        options: [
          {
            id: `real-leg-${legs.length}`,
            mode: "walk",
            label: `Walk to ${segment.originWalk.toName}`,
            durationMin: Math.max(1, Math.round(segment.originWalk.secs / 60)),
            departures: [],
            costEuro: 0,
            co2Kg: 0,
          },
        ],
      });
    }

    const realLegs = segment.legs.filter((l) => l.type === "ride" || l.fromName !== l.toName);

    realLegs.forEach((leg, legIndex) => {
      const id = `leg-${segIndex}-${legIndex}`;
      legs.push({
        id,
        from: leg.fromName,
        to: leg.toName,
        isTransferPoint: true,
        options: [toOption(leg, legs.length)],
      });
      addCoord(leg.fromName, leg.fromCode);
      addCoord(leg.toName, leg.toCode);
    });

    if (segment.destWalk.secs > 0 && segment.destWalk.fromName !== segment.to) {
      legs.push({
        id: `leg-${segIndex}-dest-walk`,
        from: segment.destWalk.fromName,
        to: segment.to,
        isTransferPoint: true,
        options: [
          {
            id: `real-leg-${legs.length}`,
            mode: "walk",
            label: `Walk to ${segment.to}`,
            durationMin: Math.max(1, Math.round(segment.destWalk.secs / 60)),
            departures: [],
            costEuro: 0,
            co2Kg: 0,
          },
        ],
      });
    }
  });

  if (legs.length === 0) {
    return { ok: false, error: "That journey is too short to break into steps - try two different places." };
  }
  // Only the very last leg isn't itself a mid-journey transfer point.
  legs[legs.length - 1].isTransferPoint = false;

  const corridor: Corridor = {
    id: `real-${from}-${to}`.toLowerCase().replace(/\s+/g, "-"),
    name: `${result.segments[0].from} -> ${result.segments.at(-1)!.to}`,
    legs,
    stopCoords,
  };

  return { ok: true, corridor };
}

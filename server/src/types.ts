export type Mode = "walk" | "bus" | "luas" | "rail" | "cycle" | "stay";

export interface RouteOption {
  id: string;
  mode: Mode;
  label: string;
  durationMin: number;
  departures: string[];
  costEuro: number;
  co2Kg: number;
  notes?: string;
  // Set on real (planner) journeys only:
  boardAt?: string; // "HH:MM" planned departure (or stopover start)
  arriveAt?: string; // "HH:MM" planned arrival (or stopover end)
  fromStopCode?: string | null; // number on the stop pole, to find the right side of the road
  toStopCode?: string | null;
  laterDepartures?: string[]; // the same route's next departures, in case you miss this one
  live?: LiveStatus;
  tripId?: string; // real GTFS trip id, so the client can ask the server to watch it for live alerts
}

export interface LiveStatus {
  status: "on-time" | "late" | "early" | "cancelled" | "skipped" | "scheduled";
  delayMin?: number;
}

export interface Leg {
  id: string;
  from: string;
  to: string;
  isTransferPoint: boolean;
  transferAmenities?: string[];
  options: RouteOption[];
}

export interface Corridor {
  id: string;
  name: string;
  legs: Leg[];
  stopCoords: Record<string, [number, number]>;
  // Real journeys: actual door-to-door times including waits and stopovers.
  summary?: { leaveAt: string; arriveAt: string; durationMin: number; liveData: boolean };
}

/** What changed for a watched trip since the user last heard about it. */
export type AlertKind = "late" | "worse" | "improved" | "recovered" | "cancelled" | "skipped";

export interface RouteAlert {
  legId: string;
  optionId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
  // Real-journey alerts (live GTFS-R) carry structured details so the client can
  // update the step's live badge and work out whether a connection is at risk.
  id?: string;
  tripId?: string;
  kind?: AlertKind;
  title?: string;
  delayMin?: number;
}

/** One ride in the user's journey that the server should watch for live changes. */
export interface WatchedLeg {
  legId: string;
  optionId: string;
  tripId: string;
  label: string; // e.g. "Bus 39A towards Ongar"
  fromName: string;
  boardStopCode: string | null;
  boardAt: string | null; // "HH:MM"
  // What the itinerary already shows, so we only alert on changes after planning.
  knownStatus: string;
  knownDelayMin: number;
}

export interface ChatContext {
  corridorName?: string;
  preference?: string;
  currentLegFrom?: string;
  currentLegTo?: string;
  breakMinutes?: number;
  transferAmenities?: string[];
  isPro?: boolean;
  recentAlerts?: RouteAlert[];
  allowPlanning?: boolean;
  currentJourney?: {
    from: string;
    to: string;
    stopovers: { place: string; stayMinutes: number }[];
  };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

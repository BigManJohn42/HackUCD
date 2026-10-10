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

export type Preference = "fastest" | "fewest-transfers";

export interface RouteAlert {
  legId: string;
  optionId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
}

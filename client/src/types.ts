export type Mode = "walk" | "bus" | "luas" | "rail" | "cycle";

export interface RouteOption {
  id: string;
  mode: Mode;
  label: string;
  durationMin: number;
  departures: string[];
  costEuro: number;
  co2Kg: number;
  notes?: string;
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
}

export type Preference = "fastest" | "fewest-transfers" | "cheapest";

export interface RouteAlert {
  legId: string;
  optionId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

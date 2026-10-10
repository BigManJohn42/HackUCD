export interface TransportData {
  destinations: { id: string; name: string }[];
  referenceData: Record<string, unknown>;
}
export interface Journey { from: string; to: string; departureTime: string; }
export interface JourneyStep {
  id: string; mode: string; service?: string; from: string; to: string;
  departureTime: string; arrivalTime: string; instructions?: string;
}
export interface RouteOption {
  id: string; title: string; departureTime: string; arrivalTime: string;
  durationMin: number; transfers: number; steps: JourneyStep[];
}
export interface ChatMessage { role: "user" | "assistant"; content: string; routes?: RouteOption[]; }
export interface SubscriptionPlan {
  id: string; name: string; interval: "month" | "year";
  price: number; currency: string; benefits: string[];
}

import { io, type Socket } from "socket.io-client";
import type { Corridor, RouteAlert, SubscriptionPlan } from "./types";
import type { ChatMessage } from "./components/ChatWidget";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchCorridor(): Promise<Corridor> {
  return fetch("/api/corridor").then((r) => asJson<Corridor>(r));
}

export interface JourneyQuery {
  from: string;
  to: string;
  stopovers?: { place: string; stayMins: number }[]; // in travel order
  depart?: string; // "HH:MM", default now
}

export function searchJourney({ from, to, stopovers = [], depart }: JourneyQuery): Promise<Corridor> {
  const params = new URLSearchParams({ from, to });
  for (const s of stopovers) {
    params.append("via", s.place);
    params.append("stay", String(s.stayMins));
  }
  if (depart) params.set("depart", depart);
  return fetch(`/api/plan?${params.toString()}`).then((r) => asJson<Corridor>(r));
}

export function searchPlaces(query: string): Promise<string[]> {
  if (query.trim().length < 2) return Promise.resolve([]);
  return fetch(`/api/places?q=${encodeURIComponent(query.trim())}`)
    .then((r) => asJson<{ places: string[] }>(r))
    .then((r) => r.places);
}

export function askConcierge(
  message: string,
  context: Record<string, unknown>
): Promise<{ reply: string }> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, context }),
  }).then((r) => asJson<{ reply: string }>(r));
}

/** Main chat widget: the AI can call a tool to build a real journey, returned as `corridor`. */
export function askConciergeChat(
  message: string,
  history: readonly ChatMessage[],
  context: Record<string, unknown>
): Promise<{ reply: string; corridor?: Corridor }> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, context: { ...context, allowPlanning: true } }),
  }).then((r) => asJson<{ reply: string; corridor?: Corridor }>(r));
}

export function fetchBillingStatus(): Promise<{ isPro: boolean }> {
  return fetch("/api/billing/status").then((r) => asJson(r));
}

export function startCheckout(plan: SubscriptionPlan = "monthly"): Promise<{ url: string }> {
  return fetch("/api/billing/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  }).then((r) =>
    asJson(r)
  );
}

export function confirmCheckout(sessionId: string): Promise<{ isPro: boolean }> {
  return fetch(`/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`).then((r) =>
    asJson(r)
  );
}

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) socket = io({ path: "/socket.io" });
  return socket;
}

export function subscribeToAlerts(onAlert: (alert: RouteAlert) => void): () => void {
  const s = getSocket();
  s.on("route-alert", onAlert);
  return () => s.off("route-alert", onAlert);
}

/** Tells the server which legs/trips belong to the active journey, so live alerts
 * are filtered to it instead of broadcasting every disruption in Dublin. */
export function watchJourney(corridor: Corridor | null) {
  const s = getSocket();
  if (!corridor) {
    s.emit("watch-journey", { optionIds: [], tripIds: [] });
    return;
  }
  const optionIds: string[] = [];
  const tripIds: string[] = [];
  for (const leg of corridor.legs) {
    for (const option of leg.options) {
      optionIds.push(option.id);
      if (option.tripId) tripIds.push(option.tripId);
    }
  }
  s.emit("watch-journey", { optionIds, tripIds });
}

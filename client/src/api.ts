import { io, type Socket } from "socket.io-client";
import type { ChatMessage, Corridor, RouteAlert } from "./types";

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

export function searchJourney(from: string, to: string, depart?: string): Promise<Corridor> {
  const params = new URLSearchParams({ from, to });
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

export function fetchBillingStatus(): Promise<{ isPro: boolean }> {
  return fetch("/api/billing/status").then((r) => asJson(r));
}

export function startCheckout(): Promise<{ url: string }> {
  return fetch("/api/billing/create-checkout-session", { method: "POST" }).then((r) =>
    asJson(r)
  );
}

export function confirmCheckout(sessionId: string): Promise<{ isPro: boolean }> {
  return fetch(`/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`).then((r) =>
    asJson(r)
  );
}

let socket: Socket | null = null;

export function subscribeToAlerts(onAlert: (alert: RouteAlert) => void): () => void {
  if (!socket) socket = io({ path: "/socket.io" });
  socket.on("route-alert", onAlert);
  return () => socket?.off("route-alert", onAlert);
}

export type { ChatMessage };

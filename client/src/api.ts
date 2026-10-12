import { io, type Socket } from "socket.io-client";
import type { Corridor, RouteAlert, SubscriptionPlan, WatchedLeg } from "./types";
import type { ChatMessage } from "./components/ChatWidget";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// The server runs on a different port than Vite's dev server, so the session
// cookie only gets sent if every request explicitly opts in.
function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, credentials: "include" });
}

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export function signup(email: string, password: string): Promise<{ user: AuthUser }> {
  return apiFetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => asJson(r));
}

export function login(email: string, password: string): Promise<{ user: AuthUser }> {
  return apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => asJson(r));
}

export function logout(): Promise<{ ok: true }> {
  return apiFetch("/api/auth/logout", { method: "POST" }).then((r) => asJson(r));
}

/** Resolves to null (not an error) when nobody's signed in - that's a normal state. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await apiFetch("/api/auth/me");
  if (res.status === 401) return null;
  const { user } = await asJson<{ user: AuthUser }>(res);
  return user;
}

export function fetchCorridor(): Promise<Corridor> {
  return apiFetch("/api/corridor").then((r) => asJson<Corridor>(r));
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
  return apiFetch(`/api/plan?${params.toString()}`).then((r) => asJson<Corridor>(r));
}

export function searchPlaces(query: string): Promise<string[]> {
  if (query.trim().length < 2) return Promise.resolve([]);
  return apiFetch(`/api/places?q=${encodeURIComponent(query.trim())}`)
    .then((r) => asJson<{ places: string[] }>(r))
    .then((r) => r.places);
}

export function askConcierge(
  message: string,
  context: Record<string, unknown>
): Promise<{ reply: string }> {
  return apiFetch("/api/chat", {
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
  return apiFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, context: { ...context, allowPlanning: true } }),
  }).then((r) => asJson<{ reply: string; corridor?: Corridor }>(r));
}

export function fetchBillingStatus(): Promise<{
  isPro: boolean;
  plan: SubscriptionPlan | null;
  status: string;
  freePlansLeft: number | null;
}> {
  return apiFetch("/api/billing/status").then((r) => asJson(r));
}

export function startCheckout(plan: SubscriptionPlan = "monthly"): Promise<{ url: string }> {
  return apiFetch("/api/billing/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  }).then((r) =>
    asJson(r)
  );
}

export function confirmCheckout(sessionId: string): Promise<{ isPro: boolean }> {
  return apiFetch(`/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`).then((r) =>
    asJson(r)
  );
}

export interface SavedRoute {
  id: string;
  userId: string;
  name: string;
  from: string;
  to: string;
  stopovers: { place: string; stayMins: number }[];
  createdAt: string;
}

export function fetchSavedRoutes(): Promise<SavedRoute[]> {
  return apiFetch("/api/saved-routes")
    .then((r) => asJson<{ routes: SavedRoute[] }>(r))
    .then((r) => r.routes);
}

export function saveRoute(query: JourneyQuery, name?: string): Promise<SavedRoute> {
  return apiFetch("/api/saved-routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      from: query.from,
      to: query.to,
      stopovers: (query.stopovers ?? []).map((s) => ({ place: s.place, stayMins: s.stayMins })),
    }),
  })
    .then((r) => asJson<{ route: SavedRoute }>(r))
    .then((r) => r.route);
}

export function deleteSavedRoute(id: string): Promise<{ ok: true }> {
  return apiFetch(`/api/saved-routes/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => asJson(r));
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
    s.emit("watch-journey", { optionIds: [], tripIds: [], legs: [] });
    return;
  }
  const optionIds: string[] = [];
  const tripIds: string[] = [];
  const legs: WatchedLeg[] = [];
  for (const leg of corridor.legs) {
    for (const option of leg.options) {
      optionIds.push(option.id);
      if (!option.tripId) continue;
      tripIds.push(option.tripId);
      // Rides you've already got off are history - no point alerting about them.
      if (option.arriveAt && hasPassed(option.arriveAt)) continue;
      legs.push({
        legId: leg.id,
        optionId: option.id,
        tripId: option.tripId,
        label: option.label,
        fromName: leg.from,
        boardStopCode: option.fromStopCode ?? null,
        boardAt: option.boardAt ?? null,
        knownStatus: option.live?.status ?? "scheduled",
        knownDelayMin: option.live?.delayMin ?? 0,
      });
    }
  }
  s.emit("watch-journey", { optionIds, tripIds, legs });
}

/** True if an "HH:MM" (optionally "(+1 day)") plan time is already more than 5 min ago today. */
function hasPassed(hhmm: string): boolean {
  if (hhmm.includes("+")) return false;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const now = new Date();
  return Number(m[1]) * 60 + Number(m[2]) < now.getHours() * 60 + now.getMinutes() - 5;
}

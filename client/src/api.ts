import type { ChatMessage, Journey, RouteOption, SubscriptionPlan, TransportData } from "./types";

// Proposed endpoints: change these centrally when the server contract is agreed.
const endpoints = {
  transport: "/api/transport-data", routes: "/api/routes",
  chat: "/api/chat", plans: "/api/subscription-plans",
};

async function request<T>(url: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      ...(body === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    });
    if (!response.ok) throw new Error("The service is unavailable. Please try again.");
    return await response.json() as T;
  } finally { window.clearTimeout(timer); }
}

export async function fetchTransportData(): Promise<TransportData> {
  const data = await request<TransportData>(endpoints.transport);
  if (!data || !Array.isArray(data.destinations) || !data.referenceData ||
      typeof data.referenceData !== "object" || Array.isArray(data.referenceData) ||
      data.destinations.some(d => !d || typeof d.id !== "string" || typeof d.name !== "string")) {
    throw new Error("Transport data is unavailable.");
  }
  return data;
}

function validRoutes(routes: RouteOption[]): boolean {
  return Array.isArray(routes) && routes.every(r => r &&
    typeof r.id === "string" && typeof r.title === "string" &&
    Number.isFinite(r.durationMin) && r.durationMin >= 0 && Number.isInteger(r.transfers) && r.transfers >= 0 &&
    Number.isFinite(Date.parse(r.departureTime)) && Number.isFinite(Date.parse(r.arrivalTime)) &&
    Array.isArray(r.steps) && r.steps.every(s => s && typeof s.id === "string" &&
      typeof s.mode === "string" && typeof s.from === "string" && typeof s.to === "string" &&
      (s.service === undefined || typeof s.service === "string") &&
      (s.instructions === undefined || typeof s.instructions === "string") &&
      Number.isFinite(Date.parse(s.departureTime)) && Number.isFinite(Date.parse(s.arrivalTime))));
}
export async function planRoute(journey: Journey): Promise<RouteOption[]> {
  const data = await request<{ routes: RouteOption[] }>(endpoints.routes, journey);
  if (!data || !validRoutes(data.routes)) throw new Error("Route data is unavailable.");
  return data.routes;
}
export async function sendChatMessage(message: string, history: ChatMessage[], transportData: TransportData): Promise<ChatMessage> {
  const data = await request<{ reply: string; routes?: RouteOption[] }>(endpoints.chat, {
    message, history: history.map(({ role, content }) => ({ role, content })), transportData,
  });
  if (!data || typeof data.reply !== "string" || !data.reply.trim() ||
      (data.routes !== undefined && !validRoutes(data.routes))) throw new Error("The reply is unavailable.");
  return { role: "assistant", content: data.reply, routes: data.routes };
}
export async function fetchSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const data = await request<{ plans: SubscriptionPlan[] }>(endpoints.plans);
  if (!data || !Array.isArray(data.plans) || data.plans.length !== 2 ||
      data.plans.some(p => !p || typeof p.id !== "string" || typeof p.name !== "string" ||
        !Number.isFinite(p.price) || p.price < 0 || typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency) ||
        !Array.isArray(p.benefits) || p.benefits.some(b => typeof b !== "string")) ||
      !["month", "year"].every(interval => data.plans.some(p => p.interval === interval))) {
    throw new Error("Subscription plans are unavailable.");
  }
  return [...data.plans].sort((a, b) => a.interval === b.interval ? 0 : a.interval === "month" ? -1 : 1);
}

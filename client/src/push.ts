import type { Corridor } from "./types";

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function journeyIds(corridor: Corridor | null): { optionIds: string[]; tripIds: string[] } {
  const optionIds: string[] = [];
  const tripIds: string[] = [];
  for (const leg of corridor?.legs ?? []) {
    for (const option of leg.options) {
      optionIds.push(option.id);
      if (option.tripId) tripIds.push(option.tripId);
    }
  }
  return { optionIds, tripIds };
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

function getRegistration(): Promise<ServiceWorkerRegistration> {
  registrationPromise ??= navigator.serviceWorker.register("/sw.js");
  return registrationPromise;
}

/** Subscribes this browser to real push notifications (survive a closed tab,
 * unlike the Notification API alone) and tells the server which journey to
 * scope them to. Call again whenever the active journey changes. */
export async function subscribeToPush(corridor: Corridor | null): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await getRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { publicKey } = await fetch("/api/push/public-key").then((r) => r.json());
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const { optionIds, tripIds } = journeyIds(corridor);
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, optionIds, tripIds }),
    });
    return true;
  } catch (err) {
    console.error("[push] subscribe failed:", err);
    return false;
  }
}

/** Re-scopes the existing push subscription to a new journey, without
 * re-prompting for permission. Safe to call even if never subscribed. */
export async function updatePushJourney(corridor: Corridor | null): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return; // not subscribed yet - nothing to rescope
    const { optionIds, tripIds } = journeyIds(corridor);
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, optionIds, tripIds }),
    });
  } catch {
    /* best-effort - the old scope just stays in place */
  }
}

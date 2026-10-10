import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import type { RouteAlert } from "../types.js";

// VAPID keys identify this server to the browser's push service. Generate
// them once and persist to a local file (git-ignored) rather than requiring
// a manual setup step - same "just works" spirit as the rest of this app's
// optional integrations, except there's no external account needed here.
const KEY_FILE = path.resolve(process.cwd(), ".vapid-keys.json");

function loadOrCreateVapidKeys(): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
    if (saved.publicKey && saved.privateKey) return saved;
  } catch {
    /* no saved keys yet */
  }
  const keys = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2));
  } catch {
    /* keys will just regenerate next restart if we can't persist them */
  }
  return keys;
}

const vapidKeys = loadOrCreateVapidKeys();
webpush.setVapidDetails("mailto:eirgo@example.com", vapidKeys.publicKey, vapidKeys.privateKey);

export function getVapidPublicKey(): string {
  return vapidKeys.publicKey;
}

interface StoredSubscription {
  subscription: webpush.PushSubscription;
  optionIds: Set<string>;
  tripIds: Set<string>;
}

// Keyed by the push subscription's own endpoint URL - stable across socket
// reconnects/page reloads, unlike a socket id.
const subscriptions = new Map<string, StoredSubscription>();

export function savePushSubscription(
  subscription: webpush.PushSubscription,
  optionIds: string[],
  tripIds: string[]
) {
  subscriptions.set(subscription.endpoint, {
    subscription,
    optionIds: new Set(optionIds),
    tripIds: new Set(tripIds),
  });
}

export function removePushSubscription(endpoint: string) {
  subscriptions.delete(endpoint);
}

/** Pushes an alert to every subscription whose watched journey it matches -
 * same per-client scoping as the WebSocket alerts, so a push only arrives
 * for a disruption that's actually relevant to what you're looking at. */
export async function pushScopedAlert(alert: RouteAlert & { tripId?: string }) {
  const matches = [...subscriptions.values()].filter(
    (s) => (alert.tripId && s.tripIds.has(alert.tripId)) || s.optionIds.has(alert.optionId)
  );
  if (matches.length === 0) return;

  const payload = JSON.stringify({
    title: alert.severity === "critical" ? "ÉirGo - Disruption" : "ÉirGo - Delay",
    body: alert.message,
    tag: `${alert.legId || alert.optionId}`,
  });

  await Promise.all(
    matches.map(async (m) => {
      try {
        await webpush.sendNotification(m.subscription, payload);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          subscriptions.delete(m.subscription.endpoint); // subscription expired/revoked
        } else {
          console.error("[push] send failed:", err instanceof Error ? err.message : err);
        }
      }
    })
  );
}

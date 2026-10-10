import type { AlertImpact } from "./alertImpact";
import type { RouteAlert } from "./types";

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

export function getNotificationPermission(): NotificationPermissionState {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as NotificationPermissionState;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!("Notification" in window)) return "unsupported";
  const result = await Notification.requestPermission();
  return result as NotificationPermissionState;
}

/**
 * System notification for a live alert - only when the user needs to act: a cancelled
 * or skipped ride, or a delay that will likely break a connection. Delays that still
 * leave time to spare, and good news, stay as in-app toasts.
 */
export function notifyRouteAlert(alert: RouteAlert, impact: AlertImpact | null) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const actionNeeded = alert.severity === "critical" || impact?.tone === "risk";
  if (!actionNeeded) return;

  const notification = new Notification(`ÉirGo · ${alert.title ?? "Journey disruption"}`, {
    body: impact ? `${alert.message}\n${impact.text}` : alert.message,
    // One notification per trip: a newer update replaces the older one in the tray.
    tag: alert.tripId ?? `${alert.legId}-${alert.optionId}`,
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  if ("vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
}

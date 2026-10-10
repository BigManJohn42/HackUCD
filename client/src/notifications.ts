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

const SEVERITY_LABEL: Record<RouteAlert["severity"], string> = {
  info: "Service update",
  warning: "Delay",
  critical: "Disruption",
};

export function notifyRouteAlert(alert: RouteAlert) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const notification = new Notification(`ÉirGo - ${SEVERITY_LABEL[alert.severity]}`, {
    body: alert.message,
    tag: `${alert.legId}-${alert.optionId}`,
    silent: alert.severity === "info",
  });
  // Auto-dismiss so a quiet info update doesn't linger in the OS notification tray.
  setTimeout(() => notification.close(), 10_000);

  if (alert.severity !== "info" && "vibrate" in navigator) {
    navigator.vibrate?.(alert.severity === "critical" ? [120, 60, 120] : [80]);
  }
}

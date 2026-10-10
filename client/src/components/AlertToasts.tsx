import { useEffect } from "react";
import { alertImpact, alertSubject } from "../alertImpact";
import type { AlertKind, Corridor, RouteAlert } from "../types";

const AUTO_DISMISS_MS = 10_000; // good news doesn't need to hang around

const ICON: Record<AlertKind, string> = {
  late: "⏱", // stopwatch
  worse: "⏱",
  improved: "↗", // arrow up-right: catching up
  recovered: "✓", // check
  cancelled: "✕", // cross
  skipped: "✕",
};

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  return `${mins} min ago`;
}

function Toast({
  alert,
  corridor,
  selections,
  onDismiss,
  onShowStep,
}: {
  alert: RouteAlert;
  corridor: Corridor | null;
  selections: Record<string, string>;
  onDismiss: () => void;
  onShowStep: (legId: string) => void;
}) {
  const impact = alertImpact(corridor, selections, alert);
  // A delay only becomes urgent if it actually breaks the plan.
  const tone =
    alert.severity === "critical" || impact?.tone === "risk"
      ? "critical"
      : alert.severity === "info" || impact?.tone === "ok"
        ? "good"
        : "warning";
  const autoDismiss = alert.severity === "info";

  useEffect(() => {
    if (!autoDismiss) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [autoDismiss, onDismiss]);

  const legExists = !!corridor?.legs.some((l) => l.id === alert.legId);

  return (
    <div className={`toast toast-${tone}`} role={tone === "critical" ? "alert" : "status"}>
      <div className="toast-icon" aria-hidden="true">
        {ICON[alert.kind ?? "late"]}
      </div>
      <div className="toast-body">
        <p className="toast-title">{alert.title ?? alert.message}</p>
        {alert.title && <p className="toast-message">{alert.message}</p>}
        {impact && <p className={`toast-impact impact-${impact.tone}`}>{impact.text}</p>}
        <div className="toast-footer">
          <span className="toast-time">Live update &middot; {relativeTime(alert.timestamp)}</span>
          {legExists && (
            <button type="button" className="toast-link" onClick={() => onShowStep(alert.legId)}>
              Show step
            </button>
          )}
        </div>
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        &times;
      </button>
    </div>
  );
}

/** Live disruption updates for the current journey, as a stack of toasts. */
export function AlertToasts({
  alerts,
  corridor,
  selections,
  onDismiss,
}: {
  alerts: RouteAlert[];
  corridor: Corridor | null;
  selections: Record<string, string>;
  onDismiss: (alert: RouteAlert) => void;
}) {
  if (alerts.length === 0) return null;

  function showStep(legId: string) {
    const el = document.getElementById(`leg-${legId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("leg-highlight");
    void el.offsetWidth; // restart the highlight animation
    el.classList.add("leg-highlight");
  }

  return (
    <div className="toast-stack" aria-live="polite">
      {alerts.slice(0, 3).map((alert) => (
        <Toast
          key={alertSubject(alert)}
          alert={alert}
          corridor={corridor}
          selections={selections}
          onDismiss={() => onDismiss(alert)}
          onShowStep={showStep}
        />
      ))}
    </div>
  );
}

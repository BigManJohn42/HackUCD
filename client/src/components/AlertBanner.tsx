import type { RouteAlert } from "../types";

export function AlertBanner({
  alert,
  onDismiss,
}: {
  alert: RouteAlert;
  onDismiss: () => void;
}) {
  return (
    <div className={`alert-banner ${alert.severity}`} role="status">
      <span>{alert.message}</span>
      <button type="button" aria-label="Dismiss alert" onClick={onDismiss}>
        &times;
      </button>
    </div>
  );
}

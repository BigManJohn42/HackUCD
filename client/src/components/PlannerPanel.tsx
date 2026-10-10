import { AlertToasts } from "./AlertToasts";
import { ItineraryStep } from "./ItineraryStep";
import { JourneySearchForm } from "./JourneySearchForm";
import { PreferenceToggle } from "./PreferenceToggle";
import { RouteMap } from "./RouteMap";
import type { Corridor, Leg, Preference, RouteAlert } from "../types";
import type { NotificationPermissionState } from "../notifications";
import type { JourneyQuery } from "../api";

export interface PlannerPanelProps {
  corridor: Corridor | null;
  preference: Preference;
  onPreferenceChange: (p: Preference) => void;
  selections: Record<string, string>;
  onSelectOption: (legId: string, optionId: string) => void;
  openBreaks: Record<string, boolean>;
  onToggleBreak: (legId: string) => void;
  onGetBreakSuggestion: (leg: Leg, minutes: number) => Promise<string>;
  alerts: RouteAlert[];
  onDismissAlert: (alert: RouteAlert) => void;
  myLocationEnabled: boolean;
  onToggleMyLocation: () => void;
  notifPermission: NotificationPermissionState;
  onEnableNotifications: () => void;
  searching: boolean;
  searchError: string | null;
  onSearch: (query: JourneyQuery) => void;
  onLoadSample: () => void;
  totals: { durationMin: number } | null;
  freePlansLeft: number | null; // null = Pro (unlimited)
}

export function PlannerPanel({
  corridor,
  preference,
  onPreferenceChange,
  selections,
  onSelectOption,
  openBreaks,
  onToggleBreak,
  onGetBreakSuggestion,
  alerts,
  onDismissAlert,
  myLocationEnabled,
  onToggleMyLocation,
  notifPermission,
  onEnableNotifications,
  searching,
  searchError,
  onSearch,
  onLoadSample,
  totals,
  freePlansLeft,
}: PlannerPanelProps) {
  const showPreferenceToggle = !!corridor && corridor.legs.some((l) => l.options.length > 1);

  return (
    <>
      <JourneySearchForm
        onSearch={onSearch}
        onLoadSample={onLoadSample}
        searching={searching}
        error={searchError}
        freePlansLeft={freePlansLeft}
      />

      <AlertToasts alerts={alerts} corridor={corridor} selections={selections} onDismiss={onDismissAlert} />

      {corridor && (
        <>
          {showPreferenceToggle && <PreferenceToggle value={preference} onChange={onPreferenceChange} />}

          <div className="card">
            <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 600 }}>{corridor.name}</p>
            {corridor.summary && (
              <p className="leg-meta" style={{ marginTop: 0 }}>
                Leave {corridor.summary.leaveAt} &middot; arrive {corridor.summary.arriveAt}
                {corridor.summary.liveData ? " · live delays included" : " · timetable only (no live data)"}
              </p>
            )}
            {totals && (
              <div className="summary-bar">
                <div>
                  <span>Total time</span>
                  {totals.durationMin >= 60
                    ? `${Math.floor(totals.durationMin / 60)}h ${String(totals.durationMin % 60).padStart(2, "0")}m`
                    : `${totals.durationMin} min`}
                </div>
              </div>
            )}
          </div>

          <RouteMap corridor={corridor} selections={selections} myLocationEnabled={myLocationEnabled} />

          <div className="card map-controls">
            <button type="button" className="btn-secondary" onClick={onToggleMyLocation}>
              {myLocationEnabled ? "Hide my location" : "Show my location on map"}
            </button>
            {notifPermission === "granted" ? (
              <span className="notif-status">Push notifications are on - you'll get them even with the app closed</span>
            ) : notifPermission === "denied" ? (
              <span className="notif-status">Notifications blocked - enable them in your browser's site settings</span>
            ) : notifPermission === "unsupported" ? null : (
              <button type="button" className="btn-secondary" onClick={onEnableNotifications}>
                Enable push notifications for delays
              </button>
            )}
          </div>

          <div className="card">
            {corridor.legs.map((leg) => (
              <ItineraryStep
                key={leg.id}
                leg={leg}
                selectedOptionId={selections[leg.id]}
                onSelectOption={(optionId) => onSelectOption(leg.id, optionId)}
                breakOpen={!!openBreaks[leg.id]}
                onToggleBreak={() => onToggleBreak(leg.id)}
                onGetBreakSuggestion={(minutes) => onGetBreakSuggestion(leg, minutes)}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

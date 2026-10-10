import { useEffect, useMemo, useState } from "react";
import {
  askConcierge,
  confirmCheckout,
  fetchBillingStatus,
  fetchCorridor,
  startCheckout,
  subscribeToAlerts,
} from "./api";
import { AlertBanner } from "./components/AlertBanner";
import { ChatPanel } from "./components/ChatPanel";
import { ItineraryStep } from "./components/ItineraryStep";
import { PreferenceToggle } from "./components/PreferenceToggle";
import { ProBanner } from "./components/ProBanner";
import { RouteMap } from "./components/RouteMap";
import {
  getNotificationPermission,
  notifyRouteAlert,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "./notifications";
import type { ChatMessage, Corridor, Leg, Preference, RouteAlert, RouteOption } from "./types";

const TRANSIT_MODES = new Set(["bus", "luas", "rail"]);

function scoreOption(option: RouteOption, preference: Preference): number {
  if (preference === "cheapest") return option.costEuro * 1000 + option.durationMin;
  if (preference === "fewest-transfers") {
    return (TRANSIT_MODES.has(option.mode) ? 1000 : 0) + option.durationMin;
  }
  return option.durationMin;
}

function defaultSelections(corridor: Corridor, preference: Preference): Record<string, string> {
  const map: Record<string, string> = {};
  for (const leg of corridor.legs) {
    const best = [...leg.options].sort((a, b) => scoreOption(a, preference) - scoreOption(b, preference))[0];
    map[leg.id] = best.id;
  }
  return map;
}

export default function App() {
  const [corridor, setCorridor] = useState<Corridor | null>(null);
  const [preference, setPreference] = useState<Preference>("fastest");
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [openBreaks, setOpenBreaks] = useState<Record<string, boolean>>({});
  const [alerts, setAlerts] = useState<RouteAlert[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPro, setIsPro] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermissionState>("default");
  const [myLocationEnabled, setMyLocationEnabled] = useState(false);

  useEffect(() => {
    fetchCorridor()
      .then((c) => {
        setCorridor(c);
        setSelections(defaultSelections(c, "fastest"));
      })
      .catch(() => setLoadError("Could not load the route. Is the server running on port 4000?"));

    fetchBillingStatus()
      .then((s) => setIsPro(s.isPro))
      .catch(() => undefined);

    setNotifPermission(getNotificationPermission());

    const unsubscribe = subscribeToAlerts((alert) => {
      setAlerts((prev) => [alert, ...prev].slice(0, 5));
      notifyRouteAlert(alert);
    });

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("checkout") === "success" && sessionId) {
      confirmCheckout(sessionId)
        .then((r) => setIsPro(r.isPro))
        .finally(() => window.history.replaceState({}, "", window.location.pathname));
    }

    return unsubscribe;
  }, []);

  function handlePreferenceChange(next: Preference) {
    setPreference(next);
    if (corridor) setSelections(defaultSelections(corridor, next));
  }

  function handleSelectOption(legId: string, optionId: string) {
    setSelections((prev) => ({ ...prev, [legId]: optionId }));
  }

  function handleToggleBreak(legId: string) {
    setOpenBreaks((prev) => ({ ...prev, [legId]: !prev[legId] }));
  }

  async function handleGetBreakSuggestion(leg: Leg, minutes: number): Promise<string> {
    const { reply } = await askConcierge(
      `I have ${minutes} minutes free at ${leg.to}. What should I do, and when should I continue my journey?`,
      {
        corridorName: corridor?.name,
        preference,
        currentLegFrom: leg.from,
        currentLegTo: leg.to,
        breakMinutes: minutes,
        transferAmenities: leg.transferAmenities,
        recentAlerts: alerts.slice(0, 3),
      }
    );
    return reply;
  }

  async function handleSendChat(message: string) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    try {
      const { reply } = await askConcierge(message, {
        corridorName: corridor?.name,
        preference,
        recentAlerts: alerts.slice(0, 3),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't reach the concierge just now." },
      ]);
    }
  }

  async function handleEnableNotifications() {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
  }

  async function handleUpgrade() {
    setUpgrading(true);
    try {
      const { url } = await startCheckout();
      window.location.href = url;
    } catch {
      setUpgrading(false);
      alert("Could not start checkout. Make sure STRIPE_SECRET_KEY is set in server/.env.");
    }
  }

  const totals = useMemo(() => {
    if (!corridor) return null;
    let durationMin = 0;
    let costEuro = 0;
    let co2Kg = 0;
    for (const leg of corridor.legs) {
      const option = leg.options.find((o) => o.id === selections[leg.id]) ?? leg.options[0];
      durationMin += option.durationMin;
      costEuro += option.costEuro;
      co2Kg += option.co2Kg;
    }
    return { durationMin, costEuro, co2Kg };
  }, [corridor, selections]);

  if (loadError) {
    return (
      <div className="app">
        <p role="alert">{loadError}</p>
      </div>
    );
  }

  if (!corridor) {
    return (
      <div className="app">
        <p>Loading your route...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>ÉirGo</h1>
        <p>{corridor.name}</p>
      </header>

      {alerts.map((alert, i) => (
        <AlertBanner
          key={`${alert.timestamp}-${i}`}
          alert={alert}
          onDismiss={() => setAlerts((prev) => prev.filter((_, idx) => idx !== i))}
        />
      ))}

      <ProBanner isPro={isPro} upgrading={upgrading} onUpgrade={handleUpgrade} />

      <PreferenceToggle value={preference} onChange={handlePreferenceChange} />

      <div className="card">
        {totals && (
          <div className="summary-bar">
            <div><span>Total time</span>{totals.durationMin} min</div>
            <div><span>Total cost</span>&euro;{totals.costEuro.toFixed(2)}</div>
            <div><span>CO2</span>{totals.co2Kg.toFixed(1)} kg</div>
          </div>
        )}
      </div>

      <RouteMap corridor={corridor} selections={selections} myLocationEnabled={myLocationEnabled} />

      <div className="card map-controls">
        <button type="button" className="btn-secondary" onClick={() => setMyLocationEnabled((v) => !v)}>
          {myLocationEnabled ? "Hide my location" : "Show my location on map"}
        </button>
        {notifPermission === "granted" ? (
          <span className="notif-status">Delay notifications are on</span>
        ) : notifPermission === "denied" ? (
          <span className="notif-status">Notifications blocked - enable them in your browser's site settings</span>
        ) : notifPermission === "unsupported" ? null : (
          <button type="button" className="btn-secondary" onClick={handleEnableNotifications}>
            Enable delay notifications
          </button>
        )}
      </div>

      <div className="card">
        {corridor.legs.map((leg) => (
          <ItineraryStep
            key={leg.id}
            leg={leg}
            selectedOptionId={selections[leg.id]}
            onSelectOption={(optionId) => handleSelectOption(leg.id, optionId)}
            breakOpen={!!openBreaks[leg.id]}
            onToggleBreak={() => handleToggleBreak(leg.id)}
            onGetBreakSuggestion={(minutes) => handleGetBreakSuggestion(leg, minutes)}
          />
        ))}
      </div>

      <ChatPanel messages={messages} onSend={handleSendChat} />
    </div>
  );
}

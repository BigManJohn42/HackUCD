import { useEffect, useMemo, useState } from "react";
import {
  askConcierge,
  confirmCheckout,
  fetchBillingStatus,
  fetchCorridor,
  searchJourney,
  startCheckout,
  subscribeToAlerts,
  type JourneyQuery,
} from "./api";
import {
  getNotificationPermission,
  notifyRouteAlert,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "./notifications";
import { HomePage } from "./pages/HomePage";
import { JourneyPlannerPage } from "./pages/JourneyPlannerPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import type { Corridor, Leg, Preference, RouteAlert, RouteOption } from "./types";

const PAGES = ["home", "journey", "subscriptions"] as const;
type Page = (typeof PAGES)[number];
const PAGE_LABEL: Record<Page, string> = {
  home: "Home",
  journey: "Journey Planner",
  subscriptions: "Subscriptions",
};

function currentPage(): Page {
  const value = window.location.hash.replace(/^#\/?/, "");
  if (value === "manual" || value === "smart") {
    window.history.replaceState({}, "", window.location.pathname + window.location.search + "#/journey");
    return "journey";
  }
  return (PAGES as readonly string[]).includes(value) ? (value as Page) : "home";
}

type FontSize = "small" | "standard" | "large";

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
  const [page, setPage] = useState<Page>(currentPage);
  const [font, setFont] = useState<FontSize>(() => {
    try {
      const saved = localStorage.getItem("eirgo-font");
      return saved === "small" || saved === "large" ? saved : "standard";
    } catch {
      return "standard";
    }
  });

  const [corridor, setCorridor] = useState<Corridor | null>(null);
  const [preference, setPreference] = useState<Preference>("fastest");
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [openBreaks, setOpenBreaks] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<RouteAlert[]>([]);
  const [isPro, setIsPro] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermissionState>("default");
  const [myLocationEnabled, setMyLocationEnabled] = useState(false);

  useEffect(() => {
    const onHashChange = () => setPage(currentPage());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.title = `${PAGE_LABEL[page]} · ÉirGo`;
  }, [page]);

  useEffect(() => {
    document.documentElement.dataset.font = font;
    try {
      localStorage.setItem("eirgo-font", font);
    } catch {
      /* font choice just won't persist across visits */
    }
  }, [font]);

  useEffect(() => {
    fetchCorridor()
      .then((c) => {
        setCorridor(c);
        setSelections(defaultSelections(c, "fastest"));
      })
      .catch(() => setLoadError("Could not load a route. Is the server running on port 4000?"));

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
        .finally(() => window.history.replaceState({}, "", window.location.pathname + window.location.hash));
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

  async function handleSearch(query: JourneyQuery) {
    setSearching(true);
    setSearchError(null);
    try {
      const c = await searchJourney(query);
      setCorridor(c);
      setPreference("fastest");
      setSelections(defaultSelections(c, "fastest"));
      setOpenBreaks({});
      setAlerts([]); // a previous journey's alerts don't apply to this one
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Could not plan that journey.");
    } finally {
      setSearching(false);
    }
  }

  async function handleLoadSample() {
    setSearching(true);
    setSearchError(null);
    try {
      const c = await fetchCorridor();
      setCorridor(c);
      setPreference("fastest");
      setSelections(defaultSelections(c, "fastest"));
      setOpenBreaks({});
      setAlerts([]);
    } catch {
      setSearchError("Could not load the sample route.");
    } finally {
      setSearching(false);
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
    for (const leg of corridor.legs) {
      const option = leg.options.find((o) => o.id === selections[leg.id]) ?? leg.options[0];
      durationMin += option.durationMin;
      costEuro += option.costEuro;
    }
    // Real journeys know the true door-to-door time (including waits and stopovers).
    if (corridor.summary) durationMin = corridor.summary.durationMin;
    return { durationMin, costEuro };
  }, [corridor, selections]);

  const plannerProps = {
    corridor,
    preference,
    onPreferenceChange: handlePreferenceChange,
    selections,
    onSelectOption: handleSelectOption,
    openBreaks,
    onToggleBreak: handleToggleBreak,
    onGetBreakSuggestion: handleGetBreakSuggestion,
    alerts,
    onDismissAlert: (index: number) => setAlerts((prev) => prev.filter((_, i) => i !== index)),
    myLocationEnabled,
    onToggleMyLocation: () => setMyLocationEnabled((v) => !v),
    notifPermission,
    onEnableNotifications: handleEnableNotifications,
    searching,
    searchError,
    onSearch: handleSearch,
    onLoadSample: handleLoadSample,
    totals,
  };

  return (
    <div className="app">
      <header className="site-header">
        <a href="#/home" className="brand">
          ÉirGo
        </a>
        <nav aria-label="Main navigation">
          {PAGES.map((p) => (
            <a key={p} href={`#/${p}`} aria-current={page === p ? "page" : undefined}>
              {PAGE_LABEL[p]}
            </a>
          ))}
        </nav>
        <div className="font-control">
          <label htmlFor="font-size">Text size</label>
          <select id="font-size" value={font} onChange={(e) => setFont(e.target.value as FontSize)}>
            <option value="small">Small</option>
            <option value="standard">Standard</option>
            <option value="large">Large</option>
          </select>
        </div>
      </header>

      <main className="app-main">
        {loadError && (
          <p role="alert" className="card">
            {loadError}
          </p>
        )}

        {page === "home" && <HomePage />}
        {page === "journey" && <JourneyPlannerPage {...plannerProps} />}
        {page === "subscriptions" && (
          <SubscriptionsPage isPro={isPro} upgrading={upgrading} onUpgrade={handleUpgrade} />
        )}
      </main>

      <footer className="site-footer">
        <span>ÉirGo</span>
        <span>A clearer journey, one step at a time.</span>
      </footer>
    </div>
  );
}

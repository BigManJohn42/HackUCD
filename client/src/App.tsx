import { useEffect, useMemo, useRef, useState } from "react";
import { alertImpact, alertSubject, liveStatusFromAlert } from "./alertImpact";
import { FREE_PLAN_LIMIT, freePlansUsed, recordFreePlan } from "./planAllowance";
import {
  askConcierge,
  askConciergeChat,
  confirmCheckout,
  deleteSavedRoute,
  fetchBillingStatus,
  fetchCorridor,
  fetchCurrentUser,
  fetchSavedRoutes,
  saveRoute,
  searchJourney,
  startCheckout,
  subscribeToAlerts,
  watchJourney,
  type AuthUser,
  type JourneyQuery,
  type SavedRoute,
} from "./api";
import {
  getNotificationPermission,
  notifyRouteAlert,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "./notifications";
import { subscribeToPush, updatePushJourney } from "./push";
import { HomePage } from "./pages/HomePage";
import { AccountPage } from "./pages/AccountPage";
import { ChatWidget, type ChatMessage } from "./components/ChatWidget";
import { JourneyPlannerPage } from "./pages/JourneyPlannerPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import type { Corridor, Leg, Preference, RouteAlert, RouteOption, SubscriptionPlan } from "./types";

const PLAN_STORAGE_KEY = "eirgo-plan";

interface StoredPlan {
  corridor: Corridor;
  selections: Record<string, string>;
  preference: Preference;
}

function loadStoredPlan(): StoredPlan | null {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.corridor?.legs) return null;
    return parsed as StoredPlan;
  } catch {
    return null;
  }
}

const PAGES = ["home", "journey", "subscriptions", "account"] as const;
type Page = (typeof PAGES)[number];
const PAGE_LABEL: Record<Page, string> = {
  home: "Home",
  journey: "Journey Planner",
  subscriptions: "Subscriptions",
  account: "Account",
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
  if (preference === "fewest-transfers") {
    return (TRANSIT_MODES.has(option.mode) ? 1000 : 0) + option.durationMin;
  }
  return option.durationMin;
}

function defaultSelections(corridor: Corridor, preference: Preference): Record<string, string> {
  const map: Record<string, string> = {};
  for (const leg of corridor.legs) {
    if (corridor.summary && preference === "fastest") {
      map[leg.id] = leg.options[0].id; // the planner's choice (alternatives come after it)
      continue;
    }
    const best = [...leg.options].sort((a, b) => scoreOption(a, preference) - scoreOption(b, preference))[0];
    map[leg.id] = best.id;
  }
  return map;
}

/** "HH:MM" (optionally "HH:MM (+1 day)") plus some minutes, wrapping at 24h. */
function addMinutesToTime(time: string, minutesToAdd: number): string {
  const clean = time.replace(/\s*\(\+1 day\)\s*$/, "");
  const [h, m] = clean.split(":").map(Number);
  const total = (((h * 60 + m + minutesToAdd) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Minutes from one "HH:MM" to a later one, assuming at most one midnight crossing. */
function minutesBetween(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.replace(/\s*\(\+1 day\)\s*$/, "").split(":").map(Number);
    return h * 60 + m;
  };
  const s = toMin(start);
  const e = toMin(end);
  return e >= s ? e - s : e + 1440 - s;
}

/** Replaces everything after `idx` with a freshly planned continuation, so a
 * long break actually reflects real departures after it - not just the
 * schedule that was true when the journey was first searched. */
function spliceContinuation(corridor: Corridor, idx: number, continuation: Corridor): Corridor {
  const keep = corridor.legs.slice(0, idx + 1);
  const prefix = `${corridor.legs[idx].id}-cont`;
  const added = continuation.legs.map((leg, i) => ({
    ...leg,
    id: `${prefix}-${i}`,
    options: leg.options.map((opt, j) => ({ ...opt, id: `${prefix}-${i}-${j}` })),
  }));
  const legs = [...keep, ...added];
  const stopCoords = { ...corridor.stopCoords, ...continuation.stopCoords };
  const summary =
    corridor.summary && continuation.summary
      ? {
          leaveAt: corridor.summary.leaveAt,
          arriveAt: continuation.summary.arriveAt,
          durationMin: minutesBetween(corridor.summary.leaveAt, continuation.summary.arriveAt),
          liveData: continuation.summary.liveData,
        }
      : corridor.summary;
  return { ...corridor, legs, stopCoords, summary };
}

export default function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem("eirgo-theme") === "dark";
    } catch {
      return false;
    }
  });
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
  // The alert listener is registered once, so it reads the latest plan through refs.
  const corridorRef = useRef<Corridor | null>(null);
  const selectionsRef = useRef<Record<string, string>>({});
  corridorRef.current = corridor;
  selectionsRef.current = selections;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [freeUsed, setFreeUsed] = useState(freePlansUsed);
  const [billingFreePlansLeft, setBillingFreePlansLeft] = useState<number | null>(null);
  const [planLimitHit, setPlanLimitHit] = useState(false);
  // Anonymous visitors get a soft, client-tracked trial; once signed in, the
  // server's real count (not resettable by clearing storage) takes over.
  const freePlansLeft = user ? billingFreePlansLeft : isPro ? null : Math.max(0, FREE_PLAN_LIMIT - freeUsed);
  const [upgrading, setUpgrading] = useState<SubscriptionPlan | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [lastQuery, setLastQuery] = useState<JourneyQuery | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  const [routeJustSaved, setRouteJustSaved] = useState(false);
  const [loadingSavedRouteId, setLoadingSavedRouteId] = useState<string | null>(null);
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
    const theme = darkMode ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("eirgo-theme", theme);
    } catch {
      /* The toggle still works when browser storage is unavailable. */
    }
  }, [darkMode]);

  useEffect(() => {
    document.documentElement.dataset.font = font;
    try {
      localStorage.setItem("eirgo-font", font);
    } catch {
      /* font choice just won't persist across visits */
    }
  }, [font]);

  useEffect(() => {
    const stored = loadStoredPlan();
    if (stored) {
      setCorridor(stored.corridor);
      setSelections(stored.selections);
      setPreference(stored.preference);
    } else {
      fetchCorridor()
        .then((c) => {
          setCorridor(c);
          setSelections(defaultSelections(c, "fastest"));
        })
        .catch(() => setLoadError("Could not load a route. Is the server running on port 4000?"));
    }

    fetchCurrentUser()
      .then((u) => {
        setUser(u);
        if (!u) return;
        return Promise.all([
          fetchBillingStatus().then((s) => {
            setIsPro(s.isPro);
            setBillingFreePlansLeft(s.freePlansLeft);
          }),
          fetchSavedRoutes().then(setSavedRoutes),
        ]);
      })
      .catch(() => undefined);

    setNotifPermission(getNotificationPermission());

    function handleAlert(alert: RouteAlert) {
      // Did the user swap this step to walking/cycling? Then the delay doesn't affect them:
      // update the badge below, but don't interrupt them with a toast or notification.
      const leg = corridorRef.current?.legs.find((l) => l.id === alert.legId);
      const selectedId = leg ? selectionsRef.current[leg.id] ?? leg.options[0]?.id : undefined;
      const affectsPlan = !leg || selectedId === alert.optionId;

      // One card per trip: a newer update replaces the older one instead of piling up.
      if (affectsPlan) {
        setAlerts((prev) => [alert, ...prev.filter((a) => alertSubject(a) !== alertSubject(alert))].slice(0, 5));
      }

      // Keep the step's live badge in sync with the latest news.
      const live = liveStatusFromAlert(alert);
      if (live && alert.tripId) {
        setCorridor((c) =>
          c && {
            ...c,
            legs: c.legs.map((l) => ({
              ...l,
              options: l.options.map((o) => (o.tripId === alert.tripId ? { ...o, live } : o)),
            })),
          }
        );
      }

      if (affectsPlan) notifyRouteAlert(alert, alertImpact(corridorRef.current, selectionsRef.current, alert));
    }
    const unsubscribe = subscribeToAlerts(handleAlert);

    // Dev/demo only: simulate a live delay on the current plan from the browser console,
    // e.g. __eirgoDemoDelay(12) delays the first ride 12 min, __eirgoDemoDelay(0, 1, "cancelled").
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__eirgoDemoDelay = (
        delayMin = 10,
        rideIndex = 0,
        kind: "late" | "cancelled" | "recovered" = "late"
      ) => {
        const rides = (corridorRef.current?.legs ?? []).flatMap((l) =>
          l.options.filter((o) => o.tripId).map((o) => ({ leg: l, option: o }))
        );
        const ride = rides[rideIndex];
        if (!ride) return "No live-tracked rides in the current plan - search a real journey first.";
        const short = ride.option.label.split(" towards ")[0];
        handleAlert({
          id: `demo-${Date.now()}`,
          legId: ride.leg.id,
          optionId: ride.option.id,
          tripId: ride.option.tripId,
          kind,
          delayMin: kind === "late" ? delayMin : 0,
          severity: kind === "cancelled" ? "critical" : kind === "recovered" ? "info" : "warning",
          title:
            kind === "cancelled" ? `${short} cancelled` : kind === "recovered" ? `${short} back on schedule` : `${short} is ${delayMin} min late`,
          message:
            kind === "cancelled"
              ? `The ${ride.option.boardAt} ${ride.option.label} from ${ride.leg.from} has been cancelled.`
              : kind === "recovered"
                ? `The ${ride.option.boardAt} ${ride.option.label} is running on time again.`
                : `The ${ride.option.boardAt} ${ride.option.label} from ${ride.leg.from} is running ${delayMin} min late.`,
          timestamp: new Date().toISOString(),
        });
        return `Simulated ${kind} on ${short}`;
      };
    }

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("checkout") === "success" && sessionId) {
      confirmCheckout(sessionId)
        .then((r) => {
          setIsPro(r.isPro);
          setBillingFreePlansLeft(null);
        })
        .finally(() => window.history.replaceState({}, "", window.location.pathname + window.location.hash));
    }

    return unsubscribe;
  }, []);

  // Keep the plan on screen across a page refresh, instead of always resetting
  // to the sample corridor.
  useEffect(() => {
    if (!corridor) return;
    try {
      localStorage.setItem(
        PLAN_STORAGE_KEY,
        JSON.stringify({ corridor, selections, preference } satisfies StoredPlan)
      );
    } catch {
      /* the plan just won't survive a refresh if storage is unavailable */
    }
  }, [corridor, selections, preference]);

  // Tell the server which legs/trips are in view, so live alerts are filtered
  // to this journey instead of broadcasting every disruption in Dublin.
  useEffect(() => {
    watchJourney(corridor);
    updatePushJourney(corridor); // no-op until the user has enabled push
  }, [corridor]);

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

  // After a break is actually set, re-plan everything from that point onward
  // using the real departure board for the resume time - not just the
  // schedule that was true when the journey was first searched.
  async function maybeExtendAfterBreak(leg: Leg, minutes: number) {
    if (!corridor) return;
    const idx = corridor.legs.findIndex((l) => l.id === leg.id);
    if (idx === -1 || idx === corridor.legs.length - 1) return; // nothing after this leg
    const selected = leg.options.find((o) => o.id === selections[leg.id]) ?? leg.options[0];
    if (!selected.arriveAt) return; // sample corridor / not a real timed leg - nothing to recompute from
    const finalDestination = corridor.legs[corridor.legs.length - 1].to;
    if (leg.to === finalDestination) return;

    const resumeTime = addMinutesToTime(selected.arriveAt, minutes);
    try {
      const continuation = await searchJourney({ from: leg.to, to: finalDestination, depart: resumeTime });
      const prefix = `${leg.id}-cont`;
      setCorridor((prev) => (prev && prev.legs[idx]?.id === leg.id ? spliceContinuation(prev, idx, continuation) : prev));
      setSelections((prev) => {
        const next = { ...prev };
        continuation.legs.forEach((_, i) => {
          next[`${prefix}-${i}`] = `${prefix}-${i}-0`; // default to each new leg's primary option
        });
        return next;
      });
    } catch {
      // keep the existing plan if a continuation can't be found (e.g. place mismatch)
    }
  }

  async function handleGetBreakSuggestion(leg: Leg, minutes: number): Promise<string> {
    const [{ reply }] = await Promise.all([
      askConcierge(
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
      ),
      maybeExtendAfterBreak(leg, minutes),
    ]);
    return reply;
  }

  function applyCorridor(c: Corridor) {
    setCorridor(c);
    setPreference("fastest");
    setSelections(defaultSelections(c, "fastest"));
    setOpenBreaks({});
    setAlerts([]); // a previous journey's alerts don't apply to this one
  }

  /** Free users get FREE_PLAN_LIMIT real journey plans; after that, the planner sends them to Pro.
   * Anonymous visitors are checked against the client-side trial counter (soft, by design -
   * it shouldn't block someone from trying the product before they've even signed up); signed-in
   * users are checked against the server's real count instead. */
  function outOfFreePlans(): boolean {
    if (isPro) return false;
    const hit = user ? billingFreePlansLeft === 0 : freePlansUsed() >= FREE_PLAN_LIMIT;
    if (!hit) return false;
    setPlanLimitHit(true);
    window.location.hash = "#/subscriptions";
    return true;
  }

  function countFreePlan() {
    if (isPro) return;
    if (user) {
      // The server already incremented its own count on a successful plan; just
      // re-sync the display rather than guessing the new value client-side.
      fetchBillingStatus()
        .then((s) => setBillingFreePlansLeft(s.freePlansLeft))
        .catch(() => undefined);
    } else {
      setFreeUsed(recordFreePlan());
    }
  }

  async function handleSearch(query: JourneyQuery) {
    if (outOfFreePlans()) return;
    setSearching(true);
    setSearchError(null);
    try {
      applyCorridor(await searchJourney(query));
      countFreePlan(); // only successful plans use up the allowance; the sample route is free
      setLastQuery(query);
      setRouteJustSaved(false);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Could not plan that journey.");
    } finally {
      setSearching(false);
      setLoadingSavedRouteId(null);
    }
  }

  async function handleSaveRoute() {
    if (!lastQuery || savingRoute) return;
    setSavingRoute(true);
    try {
      const route = await saveRoute(lastQuery);
      setSavedRoutes((prev) => [route, ...prev]);
      setRouteJustSaved(true);
    } catch {
      alert("Could not save this route. Please try again.");
    } finally {
      setSavingRoute(false);
    }
  }

  function handleLoadSavedRoute(route: SavedRoute) {
    setLoadingSavedRouteId(route.id);
    handleSearch({ from: route.from, to: route.to, stopovers: route.stopovers });
  }

  async function handleDeleteSavedRoute(route: SavedRoute) {
    setSavedRoutes((prev) => prev.filter((r) => r.id !== route.id));
    try {
      await deleteSavedRoute(route.id);
    } catch {
      // Re-sync with the server if the delete didn't actually go through.
      fetchSavedRoutes().then(setSavedRoutes).catch(() => undefined);
    }
  }

  async function handleLoadSample() {
    setSearching(true);
    setSearchError(null);
    try {
      applyCorridor(await fetchCorridor());
    } catch {
      setSearchError("Could not load the sample route.");
    } finally {
      setSearching(false);
    }
  }

  async function handleEnableNotifications() {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
    if (result === "granted") await subscribeToPush(corridor);
  }

  async function handleChatSend(message: string, history: readonly ChatMessage[]): Promise<string> {
    // Real journeys carry enough structure (a "stay" leg per stopover) to
    // describe the current plan back to the model, so "add a stop in X" or
    // "make the Ennis stop 3 hours" can be understood as an edit rather than
    // needing the whole trip restated.
    const currentJourney =
      corridor?.summary && corridor.legs.length > 0
        ? {
            from: corridor.legs[0].from,
            to: corridor.legs[corridor.legs.length - 1].to,
            stopovers: corridor.legs
              .filter((l) => l.options[0]?.mode === "stay")
              .map((l) => ({ place: l.from, stayMinutes: l.options[0].durationMin })),
          }
        : undefined;

    const { reply, corridor: newCorridor } = await askConciergeChat(message, history, {
      corridorName: corridor?.name,
      preference,
      recentAlerts: alerts.slice(0, 3),
      currentJourney,
    });
    if (newCorridor) {
      if (outOfFreePlans()) {
        return `${reply}\n\nYou've used your ${FREE_PLAN_LIMIT} free journey plans - upgrade to ÉirGo Pro to see this route and keep planning.`;
      }
      applyCorridor(newCorridor);
      countFreePlan();
    }
    return reply;
  }

  async function handleUpgrade(plan: SubscriptionPlan) {
    if (upgrading) return;
    // Checkout is tied to a user record now, so an anonymous visitor needs an
    // account before Stripe can attach a subscription to anything.
    if (!user) {
      window.location.hash = "#/account";
      return;
    }
    setUpgrading(plan);
    try {
      const { url } = await startCheckout(plan);
      window.location.href = url;
    } catch {
      setUpgrading(null);
      alert("Could not start checkout. Make sure STRIPE_SECRET_KEY is set in server/.env.");
    }
  }

  const totals = useMemo(() => {
    if (!corridor) return null;
    let durationMin = 0;
    for (const leg of corridor.legs) {
      const option = leg.options.find((o) => o.id === selections[leg.id]) ?? leg.options[0];
      durationMin += option.durationMin;
    }
    // Real journeys know the true door-to-door time (including waits and stopovers).
    if (corridor.summary) durationMin = corridor.summary.durationMin;
    return { durationMin };
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
    onDismissAlert: (alert: RouteAlert) =>
      setAlerts((prev) => prev.filter((a) => alertSubject(a) !== alertSubject(alert))),
    myLocationEnabled,
    onToggleMyLocation: () => setMyLocationEnabled((v) => !v),
    notifPermission,
    onEnableNotifications: handleEnableNotifications,
    searching,
    searchError,
    onSearch: handleSearch,
    onLoadSample: handleLoadSample,
    totals,
    freePlansLeft,
    savedRoutes,
    onLoadSavedRoute: handleLoadSavedRoute,
    onDeleteSavedRoute: handleDeleteSavedRoute,
    loadingSavedRouteId,
    // Only a real, just-searched journey can be saved - the sample route and a
    // corridor restored from localStorage on refresh don't have a matching query.
    canSaveRoute: !!user && !!lastQuery && !!corridor?.summary,
    onSaveRoute: handleSaveRoute,
    savingRoute,
    routeJustSaved,
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
        <div className="header-controls">
          <div className="font-control">
            <label htmlFor="font-size">Text size</label>
            <select id="font-size" value={font} onChange={(e) => setFont(e.target.value as FontSize)}>
              <option value="small">Small</option>
              <option value="standard">Standard</option>
              <option value="large">Large</option>
            </select>
          </div>
          <button
            type="button"
            className="theme-toggle"
            aria-pressed={darkMode}
            onClick={() => setDarkMode((enabled) => !enabled)}
          >
            Dark mode
          </button>
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
          <SubscriptionsPage
            isPro={isPro}
            upgrading={upgrading}
            onUpgrade={handleUpgrade}
            limitReached={planLimitHit && !isPro}
          />
        )}
        {page === "account" && (
          <AccountPage
            user={user}
            onAuthChange={(nextUser) => {
              setUser(nextUser);
              if (nextUser) {
                fetchBillingStatus()
                  .then((s) => {
                    setIsPro(s.isPro);
                    setBillingFreePlansLeft(s.freePlansLeft);
                  })
                  .catch(() => undefined);
                fetchSavedRoutes().then(setSavedRoutes).catch(() => undefined);
              } else {
                setIsPro(false);
                setBillingFreePlansLeft(null);
                setSavedRoutes([]);
              }
            }}
          />
        )}
      </main>

      <footer className="site-footer">
        <span>ÉirGo</span>
        <span>A clearer journey, one step at a time.</span>
      </footer>
      <ChatWidget visible={page === "journey"} onSend={handleChatSend} />
    </div>
  );
}

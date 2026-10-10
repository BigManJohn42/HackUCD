import { useEffect, useRef, useState } from "react";
import { fetchSubscriptionPlans, fetchTransportData, planRoute, sendChatMessage } from "./api";
import { RouteResults } from "./components/RouteResults";
import type { ChatMessage, RouteOption, SubscriptionPlan, TransportData } from "./types";

const pages = ["home", "manual", "smart", "subscriptions"] as const;
type Page = typeof pages[number];
type FontSize = "small" | "standard" | "large";
const labels = { home: "Home", manual: "Manual Planner", smart: "Smart Planner", subscriptions: "Subscriptions" };
function currentPage(): Page {
  const value = window.location.hash.replace(/^#\/?/, "");
  return pages.includes(value as Page) ? value as Page : "home";
}
function localNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function withOffset(value: string) {
  const offset = -new Date(value).getTimezoneOffset();
  const abs = Math.abs(offset);
  return `${value}:00${offset >= 0 ? "+" : "-"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export default function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [font, setFont] = useState<FontSize>(() => {
    try { const saved = localStorage.getItem("commute-font"); return saved === "small" || saved === "large" ? saved : "standard"; }
    catch { return "standard"; }
  });
  const [transport, setTransport] = useState<TransportData | null>(null);
  const [transportStatus, setTransportStatus] = useState<"loading" | "error" | "ready">("loading");
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null);
  const [plansStatus, setPlansStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [departure, setDeparture] = useState(localNow);
  const [routes, setRoutes] = useState<RouteOption[] | null>(null);
  const [routeError, setRouteError] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const routeBusy = useRef(false);
  const chatBusy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  async function loadTransport() {
    setTransportStatus("loading");
    try { setTransport(await fetchTransportData()); setTransportStatus("ready"); }
    catch { setTransportStatus("error"); }
  }
  async function loadPlans() {
    setPlansStatus("loading");
    try { setPlans(await fetchSubscriptionPlans()); setPlansStatus("ready"); }
    catch { setPlansStatus("error"); }
  }
  useEffect(() => {
    const onHash = () => setPage(currentPage());
    window.addEventListener("hashchange", onHash);
    void loadTransport();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.font = font;
    try { localStorage.setItem("commute-font", font); } catch { /* Settings still work without storage. */ }
  }, [font]);
  useEffect(() => {
    document.title = `${labels[page]} · EireGo`;
    heading.current?.focus();
    if (page === "subscriptions" && plansStatus === "idle") void loadPlans();
  }, [page]);
  useEffect(() => { if (page === "smart") chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages, sending, page]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (routeBusy.current) return;
    if (!from.trim() || !to.trim()) { setRouteError("Enter a start and end destination."); return; }
    if (from.trim().toLowerCase() === to.trim().toLowerCase()) { setRouteError("Choose different start and end destinations."); return; }
    if (!departure || !Number.isFinite(new Date(departure).getTime())) { setRouteError("Choose a valid departure date and time."); return; }
    routeBusy.current = true;
    setRouteLoading(true); setRouteError(""); setRoutes(null);
    try { setRoutes(await planRoute({ from: from.trim(), to: to.trim(), departureTime: withOffset(departure) })); }
    catch { setRouteError("We couldn’t load your routes. Your details are saved; try Find routes again."); }
    finally { routeBusy.current = false; setRouteLoading(false); }
  }
  async function send(text = draft, retry = false) {
    const content = text.trim();
    if (!content || !transport || transportStatus !== "ready" || chatBusy.current) return;
    chatBusy.current = true; setSending(true); setChatError(""); setFailedMessage(null);
    const history = retry ? messages.slice(0, -1) : messages;
    if (!retry) setMessages(prev => [...prev, { role: "user", content }]);
    setDraft("");
    try { const reply = await sendChatMessage(content, history, transport); setMessages(prev => [...prev, reply]); }
    catch { setChatError("The concierge couldn’t reply. Please try again."); setFailedMessage(content); }
    finally { chatBusy.current = false; setSending(false); }
  }
  const transportNotice = <div className="notice" role="status">
    {transportStatus === "loading" ? "Loading Dublin transport data…" : <>Transport data is unavailable. {page === "manual" ? "You can still type your destinations." : "The smart planner needs this data before it can help."}
      <button type="button" className="text-button" onClick={() => void loadTransport()}>Retry</button></>}
  </div>;

  return <>
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); heading.current?.focus(); }}>Skip to content</a>
    <header className="site-header">
      <a href="#/home" className="brand">EireGo</a>
      <nav aria-label="Main navigation">{pages.map(p => <a key={p} href={`#/${p}`} aria-current={page === p ? "page" : undefined}>{labels[p]}</a>)}</nav>
      <div className="font-control"><label htmlFor="font-size">Text size</label><select id="font-size" value={font} onChange={e => setFont(e.target.value as FontSize)}><option value="small">Small</option><option value="standard">Standard</option><option value="large">Large</option></select></div>
    </header>
    <main id="main" className="main">
      <section hidden={page !== "home"}>
        <div className="hero"><span className="eyebrow">A little clarity for your everyday journey</span>
          <h1 ref={page === "home" ? heading : undefined} tabIndex={-1}>Plan your commute<br /><em>with confidence.</em></h1>
          <p>Find your way through Dublin, one clear step at a time. Choose how you’d like to plan your journey.</p>
        </div>
        <div className="home-grid">
          {[{ page: "manual", number: "01", title: "Your journey, your way", text: "Choose where you’re going and when you want to leave.", action: "Manual Planner" }, { page: "smart", number: "02", title: "Let’s talk it through", text: "Describe your trip and let the concierge help you find a route.", action: "Smart Planner" }, { page: "subscriptions", number: "03", title: "Explore your options", text: "Discover the monthly and yearly subscription plans.", action: "Subscriptions" }].map(card => <article className="home-card" key={card.page}><span className="card-number">{card.number}</span><h2>{card.title}</h2><p>{card.text}</p><a className="button primary" href={`#/${card.page}`}>{card.action}<span aria-hidden="true">↗</span></a></article>)}
        </div>
      </section>
      <section hidden={page !== "manual"}>
        <div className="page-heading"><span className="eyebrow">Make a plan</span><h1 ref={page === "manual" ? heading : undefined} tabIndex={-1}>Where are you heading?</h1><p>Set your destinations and departure time. We’ll lay out the journey.</p></div>
        <div className="planner-grid"><form className="panel journey-form" onSubmit={search} noValidate>
          <h2>Your journey</h2>
          {transportStatus !== "ready" && transportNotice}
          <label htmlFor="from">Start destination</label><input id="from" list="destinations" value={from} onChange={e => setFrom(e.target.value)} placeholder="Where are you leaving from?" autoComplete="off" />
          <button type="button" className="swap-button" disabled={routeLoading} onClick={() => { setFrom(to); setTo(from); }}>↕ Swap destinations</button>
          <label htmlFor="to">End destination</label><input id="to" list="destinations" value={to} onChange={e => setTo(e.target.value)} placeholder="Where would you like to go?" autoComplete="off" />
          <datalist id="destinations">{transport?.destinations.map(d => <option key={d.id} value={d.name} />)}</datalist>
          <label htmlFor="departure">Departure date and time</label><input id="departure" type="datetime-local" value={departure} onChange={e => setDeparture(e.target.value)} />
          <p className="small muted">Enter time in your device’s local timezone. Journey results use Dublin time.</p>
          {routeError && <p className="error" role="alert">{routeError}</p>}
          <button className="button primary" type="submit" disabled={routeLoading}>{routeLoading ? "Finding routes…" : "Find routes"}<span aria-hidden="true">→</span></button>
        </form><div className="panel results-panel" aria-busy={routeLoading}><h2>Your route options</h2>
          {routeLoading ? <p role="status">Looking for your journey…</p> : routes !== null ? <RouteResults routes={routes} /> : <div className="empty-state"><span className="empty-symbol" aria-hidden="true">↗</span><h3>A clear path starts here</h3><p>Enter your journey details to see available routes and a step-by-step timetable.</p></div>}
        </div></div>
      </section>
      <section hidden={page !== "smart"} className="smart-page">
        <div className="page-heading"><span className="eyebrow">A helping hand</span><h1 ref={page === "smart" ? heading : undefined} tabIndex={-1}>Let’s find your way.</h1><p>Tell the concierge about your journey, in your own words.</p></div>
        <div className="panel chat-panel">
          <div className="chat-heading"><div><h2>Your EireGo assistant</h2><span className="small muted">{transportStatus === "ready" ? "Transport data available" : "Waiting for transport data"}</span></div></div>
          {transportStatus !== "ready" && transportNotice}
          <div className="chat-log" role="log" aria-label="Conversation" aria-live="polite" aria-busy={sending}>
            <div className="message assistant"><span className="message-label">EireGo</span><p>Where would you like to go? Tell me your starting point, destination, and when you’d like to travel.</p></div>
            {messages.map((m, i) => <div className={`message ${m.role}`} key={i}><span className="message-label">{m.role === "user" ? "You" : "EireGo"}</span><p>{m.content}</p>{m.routes && <RouteResults routes={m.routes} />}</div>)}
            {sending && <p role="status" className="muted">The concierge is working on your journey…</p>}
            <div ref={chatEnd} />
          </div>
          {chatError && <div className="error" role="alert">{chatError} {failedMessage && <button className="text-button" disabled={sending || transportStatus !== "ready"} onClick={() => void send(failedMessage, true)}>Retry reply</button>}</div>}
          <form className="chat-composer" onSubmit={e => { e.preventDefault(); void send(); }}><label htmlFor="message">Your message</label><div className="composer-row"><textarea id="message" rows={2} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Tell us about your journey…" /><button className="button primary" type="submit" disabled={sending || transportStatus !== "ready" || !draft.trim()}>{sending ? "Sending…" : "Send"}<span aria-hidden="true">↑</span></button></div></form>
        </div>
      </section>
      <section hidden={page !== "subscriptions"}>
        <div className="page-heading"><span className="eyebrow">Explore the plans</span><h1 ref={page === "subscriptions" ? heading : undefined} tabIndex={-1}>A plan for your routine.</h1><p>Compare monthly and yearly subscriptions.</p></div>
        {plansStatus === "loading" && <div className="panel" role="status">Loading subscription plans…</div>}
        {plansStatus === "error" && <div className="panel unavailable" role="status"><h2>Plans are currently unavailable</h2><p>We couldn’t load subscription details. Please try again.</p><button type="button" className="button primary" onClick={() => void loadPlans()}>Retry</button></div>}
        {plansStatus === "ready" && plans && <><div className="plans-grid">{plans.map(plan => <article className="panel plan-card" key={plan.id}><span className="eyebrow">{plan.interval === "month" ? "Monthly" : "Yearly"}</span><h2>{plan.name}</h2><p className="price">{new Intl.NumberFormat("en-IE", { style: "currency", currency: plan.currency }).format(plan.price)}<span> / {plan.interval}</span></p><ul className="benefits">{plan.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul></article>)}</div><p className="subscription-note">You can compare plans here. Checkout will be available in a future version.</p></>}
      </section>
    </main>
    <footer className="site-footer"><span>EireGo</span><span>A clearer journey, one step at a time.</span><span>Prototype · v0.1.1</span></footer>
  </>;
}

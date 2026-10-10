import { useState } from "react";
import type { RouteOption } from "../types";
function time(value: string) {
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin",
  }).format(new Date(value));
}
export function RouteResults({ routes }: { routes: RouteOption[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = routes.find(r => r.id === selected) ?? routes[0];
  if (!active) return <div className="empty-state"><h3>No routes found</h3><p>Try another departure time or destination.</p></div>;
  return <div className="route-results">
    <div className="route-options" role="group" aria-label="Route options">
      {routes.map(route => <button className="route-option" type="button" key={route.id}
        aria-pressed={active.id === route.id} onClick={() => setSelected(route.id)}>
        <span className="route-title">{route.title}</span>
        <span>{time(route.departureTime)} → {time(route.arrivalTime)}</span>
        <span className="muted">{route.durationMin} min · {route.transfers} {route.transfers === 1 ? "transfer" : "transfers"}</span>
      </button>)}
    </div>
    <section className="itinerary" aria-label={`Journey steps for ${active.title}`}>
      <h3>Your journey, step by step</h3>
      <ol>{active.steps.map(step => <li key={step.id}>
        <span className="step-mode">{step.mode}{step.service ? ` · ${step.service}` : ""}</span>
        <h4>{step.from} → {step.to}</h4>
        <p>{time(step.departureTime)} – {time(step.arrivalTime)}</p>
        {step.instructions && <p className="muted">{step.instructions}</p>}
      </li>)}</ol>
      {active.steps.length === 0 && <p>Detailed journey steps have not been supplied.</p>}
      <p className="small muted">All journey times are shown in Dublin time.</p>
    </section>
  </div>;
}

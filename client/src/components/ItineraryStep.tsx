import type { Leg, LiveStatus, RouteOption } from "../types";
import { BreakPanel } from "./BreakPanel";

function LiveBadge({ live }: { live?: LiveStatus }) {
  if (!live || live.status === "scheduled") return null;
  const text =
    live.status === "late"
      ? `${live.delayMin} min late`
      : live.status === "early"
        ? `${Math.abs(live.delayMin ?? 0)} min early`
        : live.status === "on-time"
          ? "On time"
          : live.status === "cancelled"
            ? "Cancelled"
            : "Skips this stop";
  return <span className={`live-badge live-${live.status}`}>Live: {text}</span>;
}

const stopLabel = (name: string, code?: string | null) => (code ? `${name} (stop ${code})` : name);

/** Real journeys: spell out exactly what to board, where, and when. */
function RealStepDetails({ leg, option }: { leg: Leg; option: RouteOption }) {
  if (option.mode === "stay") {
    return (
      <p className="leg-meta">
        Arrive {option.boardAt} &middot; leave {option.arriveAt} &middot; {option.durationMin} min here
        {option.notes ? ` · ${option.notes}` : ""}
      </p>
    );
  }
  if (option.mode === "walk") {
    return <p className="leg-meta">Walk about {option.durationMin} min</p>;
  }
  return (
    <div className="ride-details">
      <p className="ride-line">
        <strong>{option.boardAt}</strong> board at {stopLabel(leg.from, option.fromStopCode)}
        <LiveBadge live={option.live} />
      </p>
      <p className="ride-line">
        <strong>{option.arriveAt}</strong> get off at {stopLabel(leg.to, option.toStopCode)}
      </p>
      <p className="leg-meta">
        {option.durationMin} min on board
        {option.laterDepartures && option.laterDepartures.length > 0 &&
          ` · if you miss it: ${option.laterDepartures.join(", ")}`}
      </p>
    </div>
  );
}

export function ItineraryStep({
  leg,
  selectedOptionId,
  onSelectOption,
  breakOpen,
  onToggleBreak,
  onGetBreakSuggestion,
}: {
  leg: Leg;
  selectedOptionId: string;
  onSelectOption: (optionId: string) => void;
  breakOpen: boolean;
  onToggleBreak: () => void;
  onGetBreakSuggestion: (minutes: number) => Promise<string>;
}) {
  const selected = leg.options.find((o) => o.id === selectedOptionId) ?? leg.options[0];
  const isReal = selected.boardAt !== undefined || selected.id.startsWith("real-");
  const isStay = selected.mode === "stay";

  return (
    <div className={`leg${isStay ? " leg-stay" : ""}`}>
      <div className="leg-title">
        {isReal ? selected.label : <>{leg.from} &rarr; {leg.to}</>}
      </div>

      {isReal ? (
        <RealStepDetails leg={leg} option={selected} />
      ) : (
        <>
          <select
            className="leg-option-select"
            aria-label={`Choose how to travel from ${leg.from} to ${leg.to}`}
            value={selected.id}
            onChange={(e) => onSelectOption(e.target.value)}
          >
            {leg.options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label} - {opt.durationMin} min
              </option>
            ))}
          </select>

          <p className="leg-meta">
            {selected.durationMin} min
            {selected.departures.length > 0 && ` · next: ${selected.departures.slice(0, 3).join(", ")}`}
            {selected.notes ? ` · ${selected.notes}` : ""}
          </p>
        </>
      )}

      {leg.isTransferPoint && (
        <div className="leg-actions">
          <button type="button" className="btn-secondary" onClick={onToggleBreak}>
            {isStay
              ? breakOpen ? "Hide ideas" : "What can I do here?"
              : breakOpen ? "Remove break here" : "Add a break here"}
          </button>
        </div>
      )}

      {leg.isTransferPoint && breakOpen && (
        <BreakPanel amenities={leg.transferAmenities ?? []} onGetSuggestion={onGetBreakSuggestion} />
      )}
    </div>
  );
}

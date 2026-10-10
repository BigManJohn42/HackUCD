import type { Leg, Mode } from "../types";
import { BreakPanel } from "./BreakPanel";

const MODE_ICON: Record<Mode, string> = {
  walk: "\u{1F6B6}",
  bus: "\u{1F68C}",
  luas: "\u{1F686}",
  rail: "\u{1F686}",
  cycle: "\u{1F6B4}",
};

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

  return (
    <div className="leg">
      <div className="leg-title">
        {MODE_ICON[selected.mode]} {leg.from} &rarr; {leg.to}
      </div>

      <select
        className="leg-option-select"
        aria-label={`Choose how to travel from ${leg.from} to ${leg.to}`}
        value={selected.id}
        onChange={(e) => onSelectOption(e.target.value)}
      >
        {leg.options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {MODE_ICON[opt.mode]} {opt.label} - {opt.durationMin} min
          </option>
        ))}
      </select>

      <p className="leg-meta">
        {selected.durationMin} min
        {selected.costEuro > 0 ? ` · €${selected.costEuro.toFixed(2)}` : " · free"}
        {selected.departures.length > 0 && ` · next: ${selected.departures.slice(0, 3).join(", ")}`}
        {selected.notes ? ` · ${selected.notes}` : ""}
      </p>

      {leg.isTransferPoint && (
        <div className="leg-actions">
          <button type="button" className="btn-secondary" onClick={onToggleBreak}>
            {breakOpen ? "Remove break here" : "Add a break here"}
          </button>
        </div>
      )}

      {leg.isTransferPoint && breakOpen && (
        <BreakPanel amenities={leg.transferAmenities ?? []} onGetSuggestion={onGetBreakSuggestion} />
      )}
    </div>
  );
}

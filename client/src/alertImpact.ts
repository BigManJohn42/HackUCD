import type { Corridor, LiveStatus, RouteAlert, RouteOption } from "./types";

/** What a live alert means for *this* journey - the reason it's worth showing. */
export interface AlertImpact {
  tone: "ok" | "risk" | "neutral";
  text: string;
}

/** "14:02" -> 842, "00:15 (+1 day)" -> 1455. */
function toMinutes(hhmm?: string): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (hhmm!.includes("+1 day") ? 24 * 60 : 0);
}

const shortLabel = (o: RouteOption) => o.label.split(" towards ")[0];

function selectedOption(corridor: Corridor, selections: Record<string, string>, legIndex: number): RouteOption {
  const leg = corridor.legs[legIndex];
  return leg.options.find((o) => o.id === selections[leg.id]) ?? leg.options[0];
}

/** Finds the leg and ride option an alert is about. */
function locate(corridor: Corridor, alert: RouteAlert): { index: number; option: RouteOption } | null {
  for (let i = 0; i < corridor.legs.length; i++) {
    const option = corridor.legs[i].options.find((o) =>
      alert.tripId ? o.tripId === alert.tripId : o.id === alert.optionId
    );
    if (option) return { index: i, option };
  }
  return null;
}

export function alertImpact(
  corridor: Corridor | null,
  selections: Record<string, string>,
  alert: RouteAlert
): AlertImpact | null {
  if (!corridor) return null;
  const found = locate(corridor, alert);
  if (!found) return null;
  const { index, option } = found;

  if (alert.kind === "recovered") return { tone: "ok", text: "Your plan works as shown." };

  if (alert.kind === "cancelled" || alert.kind === "skipped") {
    const next = option.laterDepartures?.[0];
    return {
      tone: "risk",
      text: next
        ? `Next ${shortLabel(option)} from here is at ${next}, or search again for another route.`
        : "Search again for another route.",
    };
  }

  const delay = alert.delayMin ?? 0;
  const arrive = toMinutes(option.arriveAt);
  if (arrive === null || delay <= 0) return null;
  const newArrive = arrive + delay;

  // Walk forward to the next timed ride (or stopover), adding up any walking in between.
  let walkMins = 0;
  for (let j = index + 1; j < corridor.legs.length; j++) {
    const next = selectedOption(corridor, selections, j);
    if (next.mode === "stay") {
      const stayEnd = toMinutes(next.arriveAt);
      const spare = stayEnd !== null ? stayEnd - newArrive : null;
      return {
        tone: "neutral",
        text: `Your stopover in ${corridor.legs[j].from} will be ${delay} min shorter${
          spare !== null && spare > 0 ? ` (${spare} min there)` : ""
        }.`,
      };
    }
    const board = toMinutes(next.boardAt);
    if (board === null) {
      walkMins += next.durationMin; // walk/cycle step
      continue;
    }
    const spare = board - (newArrive + walkMins);
    if (spare >= 2) {
      return { tone: "ok", text: `You'll still make the ${next.boardAt} ${shortLabel(next)} (${spare} min to spare).` };
    }
    const fallback = next.laterDepartures?.find((t) => (toMinutes(t) ?? 0) >= newArrive + walkMins + 2);
    return {
      tone: "risk",
      text: `You'll likely miss the ${next.boardAt} ${shortLabel(next)}.${
        fallback ? ` Next one is at ${fallback}.` : " Search again for another connection."
      }`,
    };
  }
  // Nothing left to catch: the whole journey just finishes later.
  const finish = (toMinutes(corridor.summary?.arriveAt) ?? newArrive + walkMins) + delay;
  const h = Math.floor((finish % (24 * 60)) / 60);
  const m = finish % 60;
  const destination = corridor.legs[corridor.legs.length - 1]?.to;
  return {
    tone: "neutral",
    text: `You'll reach ${destination ?? "your destination"} about ${delay} min later, around ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}.`,
  };
}

/** The step's live badge after an alert, so the itinerary matches the latest news. */
export function liveStatusFromAlert(alert: RouteAlert): LiveStatus | null {
  switch (alert.kind) {
    case "late":
    case "worse":
    case "improved":
      return { status: "late", delayMin: alert.delayMin ?? 0 };
    case "recovered":
      return { status: "on-time", delayMin: 0 };
    case "cancelled":
      return { status: "cancelled" };
    case "skipped":
      return { status: "skipped" };
    default:
      return null;
  }
}

/** Same trip (real) or same leg option (sample) - a newer alert replaces the older one. */
export const alertSubject = (a: RouteAlert) => a.tripId ?? `${a.legId}:${a.optionId}`;

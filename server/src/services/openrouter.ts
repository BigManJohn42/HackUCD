import type { ChatContext, ChatTurn, Corridor } from "../types.js";
import { planRealJourney } from "./plannerBridge.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const PLAN_JOURNEY_TOOL = {
  type: "function",
  function: {
    name: "plan_journey",
    description:
      "Plan a real journey using live Irish public transport data (buses, trains, Luas) and replace the user's current itinerary with it. Call this whenever the user asks to go somewhere specific, e.g. 'go from Athlone to UCD', 'how do I get to Galway', 'plan a trip to the airport'.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Starting place or stop name, as the user said it" },
        to: { type: "string", description: "Destination place or stop name, as the user said it" },
        via: { type: "string", description: "Optional stopover place, if the user wants to break up the trip" },
        depart: { type: "string", description: "Optional departure time as HH:MM (24h), if the user gave one" },
      },
      required: ["from", "to"],
    },
  },
};

function buildSystemPrompt(context: ChatContext): string {
  const lines = [
    "You are a calm, concise commute concierge inside a journey-planning app.",
    "The user may have low confidence with the local transit system, so avoid jargon and keep replies short (3-5 sentences, plain language).",
    "When the user has a break between transfers, suggest 1-2 concrete nearby things to do that fit the time available, then clearly state which departure they should aim to catch afterwards.",
    "When you mention a live disruption, acknowledge it and give a practical fallback instead of just stating the problem.",
  ];
  if (context.corridorName) lines.push(`Route: ${context.corridorName}.`);
  if (context.preference) lines.push(`User's stated preference: ${context.preference}.`);
  if (context.currentLegFrom && context.currentLegTo) {
    lines.push(`Current leg: ${context.currentLegFrom} -> ${context.currentLegTo}.`);
  }
  if (typeof context.breakMinutes === "number") {
    lines.push(`The user has ${context.breakMinutes} minutes free right now.`);
  }
  if (context.transferAmenities?.length) {
    lines.push(`Known nearby amenities: ${context.transferAmenities.join(", ")}.`);
  }
  if (context.recentAlerts?.length) {
    lines.push(
      `Recent live alerts: ${context.recentAlerts
        .map((a) => a.message)
        .join(" ")}`
    );
  }
  lines.push(
    context.isPro
      ? "This user is on the Pro plan: give richer, more specific recommendations."
      : "This user is on the free plan: keep recommendations brief and general."
  );
  if (context.allowPlanning) {
    lines.push(
      "You can call plan_journey to actually build a route with live data whenever the user names a start and destination - do this instead of describing a route in text."
    );
  }
  return lines.join(" ");
}

export async function askConcierge(message: string, context: ChatContext): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return (
      "(AI concierge is not configured yet — add OPENROUTER_API_KEY to server/.env to enable live answers.) " +
      "In the meantime: check the departures board for your next leg and allow a few extra minutes as a buffer."
    );
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "ÉirGo",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: buildSystemPrompt(context) },
        { role: "user", content: message },
      ],
      temperature: 0.4,
      max_tokens: 400,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  return data.choices?.[0]?.message?.content ?? "Sorry, I didn't get a usable reply that time — try again.";
}

const NO_KEY_REPLY =
  "(AI concierge is not configured yet — add OPENROUTER_API_KEY to server/.env to enable live answers.)";

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string; tool_calls?: ToolCall[] } }[];
}

async function callChat(messages: unknown[], tools?: unknown[]): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("no-api-key");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "ÉirGo",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4.5",
      messages,
      temperature: 0.4,
      max_tokens: 500,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }
  return (await response.json()) as OpenRouterResponse;
}

/**
 * Chat with tool-calling: the model can call `plan_journey` to replace the
 * user's itinerary with a real, live-data route instead of just describing
 * one in text. Used by the main chat widget (not the break-suggestion panel,
 * which has no reason to re-plan the whole trip).
 */
export async function askConciergeWithTools(
  message: string,
  history: ChatTurn[],
  context: ChatContext
): Promise<{ reply: string; corridor?: Corridor }> {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      reply: `${NO_KEY_REPLY} In the meantime: use the search form above to plan a journey.`,
    };
  }

  const messages: unknown[] = [
    { role: "system", content: buildSystemPrompt(context) },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  let data;
  try {
    data = await callChat(messages, context.allowPlanning ? [PLAN_JOURNEY_TOOL] : undefined);
  } catch (err) {
    if (err instanceof Error && err.message === "no-api-key") {
      return { reply: NO_KEY_REPLY };
    }
    throw err;
  }

  const choice = data.choices?.[0]?.message;
  const toolCall: ToolCall | undefined = choice?.tool_calls?.[0];

  if (!toolCall || toolCall.function.name !== "plan_journey") {
    return { reply: choice?.content ?? "Sorry, I didn't get a usable reply that time — try again." };
  }

  let args: { from?: string; to?: string; via?: string; depart?: string };
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { reply: "I tried to plan that journey but got confused parsing the details - could you rephrase?" };
  }
  if (!args.from || !args.to) {
    return { reply: "I need both a starting point and a destination to plan a journey - could you give me both?" };
  }

  const planResult = await planRealJourney(args.from, args.to, {
    depart: args.depart,
    vias: args.via ? [args.via] : [],
  });

  const toolResultContent = planResult.ok
    ? JSON.stringify({
        ok: true,
        summary: planResult.corridor.summary,
        legCount: planResult.corridor.legs.length,
        name: planResult.corridor.name,
      })
    : JSON.stringify({ ok: false, error: planResult.error });

  const followUpMessages = [
    ...messages,
    { role: "assistant", content: choice?.content ?? null, tool_calls: [toolCall] },
    { role: "tool", tool_call_id: toolCall.id, content: toolResultContent },
  ];

  let finalReply: string;
  try {
    const followUp = await callChat(followUpMessages);
    finalReply =
      followUp.choices?.[0]?.message?.content ??
      (planResult.ok ? "Done - I've updated your itinerary above." : "I couldn't plan that journey.");
  } catch {
    finalReply = planResult.ok
      ? "Done - I've updated your itinerary above."
      : `I couldn't plan that journey: ${planResult.ok ? "" : planResult.error}`;
  }

  return { reply: finalReply, corridor: planResult.ok ? planResult.corridor : undefined };
}

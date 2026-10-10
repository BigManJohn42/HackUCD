import type { ChatContext } from "../types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
      "X-Title": "Commute Concierge",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku",
      messages: [
        { role: "system", content: buildSystemPrompt(context) },
        { role: "user", content: message },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "Sorry, I didn't get a usable reply that time — try again.";
}

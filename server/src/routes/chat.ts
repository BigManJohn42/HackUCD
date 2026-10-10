import { Router } from "express";
import { askConcierge } from "../services/openrouter.js";
import { getProStatus } from "../services/stripe.js";
import type { ChatContext } from "../types.js";

export const chatRouter = Router();

chatRouter.post("/chat", async (req, res) => {
  const { message, context } = req.body as { message?: string; context?: ChatContext };
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const reply = await askConcierge(message, { ...context, isPro: getProStatus() });
    res.json({ reply });
  } catch (err) {
    console.error("[chat] OpenRouter request failed:", err);
    res.status(502).json({ error: "The AI concierge is unavailable right now. Please try again." });
  }
});

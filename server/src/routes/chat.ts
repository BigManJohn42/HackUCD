import { Router } from "express";
import { askConcierge, askConciergeWithTools } from "../services/openrouter.js";
import { getSubscriptionStatus } from "../services/stripe.js";
import type { ChatContext, ChatTurn } from "../types.js";

export const chatRouter = Router();

chatRouter.post("/chat", async (req, res) => {
  const { message, context, history } = req.body as {
    message?: string;
    context?: ChatContext;
    history?: ChatTurn[];
  };
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Anonymous users get the free-tier prompt; richer Pro behaviour only
  // applies once we know who they are and that they're actually subscribed.
  const isPro = req.user ? getSubscriptionStatus(req.user.id).isPro : false;

  try {
    if (context?.allowPlanning) {
      const result = await askConciergeWithTools(message, Array.isArray(history) ? history : [], {
        ...context,
        isPro,
      });
      res.json(result);
      return;
    }
    const reply = await askConcierge(message, { ...context, isPro });
    res.json({ reply });
  } catch (err) {
    console.error("[chat] OpenRouter request failed:", err);
    res.status(502).json({ error: "The AI concierge is unavailable right now. Please try again." });
  }
});

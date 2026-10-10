import { Router } from "express";
import { confirmCheckoutSession, createCheckoutSession, getProStatus } from "../services/stripe.js";

export const billingRouter = Router();

billingRouter.get("/billing/status", (_req, res) => {
  res.json({ isPro: getProStatus() });
});

billingRouter.post("/billing/create-checkout-session", async (req, res) => {
  const plan = req.body?.plan === undefined ? "monthly" : req.body.plan;
  if (plan !== "monthly" && plan !== "yearly") {
    res.status(400).json({ error: "plan must be monthly or yearly" });
    return;
  }
  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  try {
    const session = await createCheckoutSession(clientOrigin, plan);
    res.json({ url: session.url });
  } catch (err) {
    console.error("[billing] failed to create checkout session:", err);
    res.status(502).json({
      error:
        err instanceof Error
          ? err.message
          : "Could not create a Stripe checkout session.",
    });
  }
});

billingRouter.get("/billing/confirm", async (req, res) => {
  const sessionId = req.query.session_id;
  if (typeof sessionId !== "string") {
    res.status(400).json({ error: "session_id is required" });
    return;
  }
  try {
    const result = await confirmCheckoutSession(sessionId);
    res.json(result);
  } catch (err) {
    console.error("[billing] failed to confirm session:", err);
    res.status(502).json({ error: "Could not confirm the checkout session." });
  }
});

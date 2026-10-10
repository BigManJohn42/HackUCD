import { Router } from "express";
import { getVapidPublicKey, removePushSubscription, savePushSubscription } from "../services/push.js";

export const pushRouter = Router();

pushRouter.get("/push/public-key", (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

pushRouter.post("/push/subscribe", (req, res) => {
  const { subscription, optionIds, tripIds } = req.body ?? {};
  if (!subscription?.endpoint) {
    res.status(400).json({ error: "subscription is required" });
    return;
  }
  savePushSubscription(
    subscription,
    Array.isArray(optionIds) ? optionIds : [],
    Array.isArray(tripIds) ? tripIds : []
  );
  res.json({ ok: true });
});

pushRouter.post("/push/unsubscribe", (req, res) => {
  const { endpoint } = req.body ?? {};
  if (typeof endpoint === "string") removePushSubscription(endpoint);
  res.json({ ok: true });
});

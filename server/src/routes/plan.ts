import { Router } from "express";
import { findStops } from "../../../src/timetable.js";
import { planRealJourney } from "../services/plannerBridge.js";

export const planRouter = Router();

planRouter.get("/plan", (req, res) => {
  const { from, to, depart } = req.query;
  if (typeof from !== "string" || typeof to !== "string" || !from.trim() || !to.trim()) {
    res.status(400).json({ error: "from and to are required" });
    return;
  }

  const result = planRealJourney(from.trim(), to.trim(), typeof depart === "string" ? depart : undefined);
  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json(result.corridor);
});

planRouter.get("/places", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) {
    res.json({ places: [] });
    return;
  }
  try {
    const seen = new Set<string>();
    const places = findStops(q)
      .filter((s) => {
        if (seen.has(s.stop_name)) return false;
        seen.add(s.stop_name);
        return true;
      })
      .slice(0, 8)
      .map((s) => s.stop_name);
    res.json({ places });
  } catch {
    res.json({ places: [] });
  }
});

import { Router } from "express";
import { findStops } from "../../../src/timetable.js";
import { planRealJourney } from "../services/plannerBridge.js";

export const planRouter = Router();

// GET /api/plan?from=UCD&to=Galway[&via=Athlone&stay=120][&via=...&stay=...][&depart=08:30]
planRouter.get("/plan", async (req, res) => {
  const { from, to, depart, via, stay } = req.query;
  if (typeof from !== "string" || typeof to !== "string" || !from.trim() || !to.trim()) {
    res.status(400).json({ error: "from and to are required" });
    return;
  }
  if (depart !== undefined && (typeof depart !== "string" || !/^\d{1,2}:\d{2}$/.test(depart))) {
    res.status(400).json({ error: "depart must be HH:MM" });
    return;
  }
  const vias = (Array.isArray(via) ? via : via === undefined ? [] : [via])
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  // Each stay pairs with the via in the same position; a single stay applies to all vias.
  const stayList = (Array.isArray(stay) ? stay : stay === undefined ? [] : [stay]).map((s) =>
    s === "" ? 120 : Number(s)
  );
  const stayMins = vias.map((_, k) => stayList[k] ?? (stayList.length === 1 ? stayList[0] : 120));
  if (vias.length > 5) {
    res.status(400).json({ error: "at most 5 stopovers" });
    return;
  }
  if (stayMins.some((m) => !Number.isFinite(m) || m < 0 || m > 3 * 24 * 60)) {
    res.status(400).json({ error: "stay must be a number of minutes (0 - 4320)" });
    return;
  }

  const result = await planRealJourney(from.trim(), to.trim(), {
    depart: typeof depart === "string" ? depart : undefined,
    vias,
    stayMins,
  });
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

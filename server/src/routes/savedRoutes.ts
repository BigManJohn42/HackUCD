import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createSavedRoute,
  deleteSavedRoute,
  listSavedRoutes,
  SavedRouteError,
  type Stopover,
} from "../services/savedRoutes.js";

export const savedRoutesRouter = Router();

savedRoutesRouter.use(requireAuth);

savedRoutesRouter.get("/saved-routes", (req, res) => {
  res.json({ routes: listSavedRoutes(req.user!.id) });
});

savedRoutesRouter.post("/saved-routes", (req, res) => {
  const { name, from, to, stopovers } = req.body ?? {};
  if (typeof from !== "string" || !from.trim() || typeof to !== "string" || !to.trim()) {
    res.status(400).json({ error: "from and to are required" });
    return;
  }
  const cleanStopovers: Stopover[] = Array.isArray(stopovers)
    ? stopovers
        .filter((s): s is { place: unknown; stayMins: unknown } => s && typeof s === "object")
        .map((s) => ({ place: String(s.place ?? ""), stayMins: Number(s.stayMins) || 0 }))
        .filter((s) => s.place.trim().length > 0)
    : [];

  const label = typeof name === "string" && name.trim() ? name.trim() : `${from.trim()} → ${to.trim()}`;
  try {
    const route = createSavedRoute(req.user!.id, label, from.trim(), to.trim(), cleanStopovers);
    res.status(201).json({ route });
  } catch (err) {
    if (err instanceof SavedRouteError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

savedRoutesRouter.delete("/saved-routes/:id", (req, res) => {
  const deleted = deleteSavedRoute(req.user!.id, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Saved route not found." });
    return;
  }
  res.json({ ok: true });
});

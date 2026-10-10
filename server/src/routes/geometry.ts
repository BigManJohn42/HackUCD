import { Router } from "express";
import { fetchRoutePath } from "../services/routeGeometry.js";

export const geometryRouter = Router();

function parseLatLon(value: unknown): [number, number] | null {
  if (typeof value !== "string") return null;
  const [lat, lon] = value.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

geometryRouter.get("/route-path", async (req, res) => {
  const from = parseLatLon(req.query.from);
  const to = parseLatLon(req.query.to);
  if (!from || !to) {
    res.status(400).json({ error: "from and to must be 'lat,lon'" });
    return;
  }
  const points = await fetchRoutePath(from, to);
  res.json({ points: points ?? [] });
});

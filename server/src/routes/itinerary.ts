import { Router } from "express";
import { belfieldToCityCentre } from "../data/corridor.js";

export const itineraryRouter = Router();

itineraryRouter.get("/corridor", (_req, res) => {
  res.json(belfieldToCityCentre);
});

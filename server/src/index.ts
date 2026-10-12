import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { itineraryRouter } from "./routes/itinerary.js";
import { chatRouter } from "./routes/chat.js";
import { billingRouter, billingWebhookHandler } from "./routes/billing.js";
import { planRouter } from "./routes/plan.js";
import { geometryRouter } from "./routes/geometry.js";
import { pushRouter } from "./routes/push.js";
import { authRouter } from "./routes/auth.js";
import { optionalAuth } from "./middleware/auth.js";
import { startLiveFeed } from "./services/liveFeed.js";
import type { WatchedLeg } from "./types.js";
import "./db/db.js"; // opens the DB and runs schema setup on import

// NTA_API_KEY and GTFS_FEED live in the repo-root .env (shared with the
// standalone `npm run delays`/`plan` scripts there) rather than server/.env;
// load it as a fallback without overriding anything server/.env already set.
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const PORT = Number(process.env.PORT) || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

// Stripe webhook signature verification needs the exact raw request bytes,
// so this is registered with express.raw() BEFORE the global JSON parser
// below touches the body.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), billingWebhookHandler);

app.use(express.json());
app.use(cookieParser());
app.use(optionalAuth);

app.use("/api", authRouter);
app.use("/api", itineraryRouter);
app.use("/api", chatRouter);
app.use("/api", billingRouter);
app.use("/api", planRouter);
app.use("/api", geometryRouter);
app.use("/api", pushRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

io.on("connection", (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);
  socket.data.watchedOptionIds = new Set<string>();
  socket.data.watchedTripIds = new Set<string>();
  socket.data.watchedLegs = [] as WatchedLeg[];

  socket.on(
    "watch-journey",
    (payload: { optionIds?: string[]; tripIds?: string[]; legs?: WatchedLeg[] }) => {
      socket.data.watchedOptionIds = new Set(Array.isArray(payload?.optionIds) ? payload.optionIds : []);
      socket.data.watchedTripIds = new Set(Array.isArray(payload?.tripIds) ? payload.tripIds : []);
      // Upcoming rides of a real journey, with what the itinerary already shows for each,
      // so the live feed only alerts on changes since then.
      const legs = Array.isArray(payload?.legs) ? payload.legs : [];
      socket.data.watchedLegs = legs
        .filter((l) => l && typeof l.tripId === "string" && typeof l.legId === "string")
        .slice(0, 30);
      // A new journey starts from a clean slate; keep known states for trips still watched.
      const states = socket.data.tripStates as Map<string, unknown> | undefined;
      if (states) {
        const keep = new Set((socket.data.watchedLegs as WatchedLeg[]).map((l) => l.tripId));
        for (const tripId of states.keys()) if (!keep.has(tripId)) states.delete(tripId);
      }
    }
  );

  socket.on("disconnect", () => console.log(`[socket] client disconnected: ${socket.id}`));
});

startLiveFeed(io);

httpServer.listen(PORT, () => {
  console.log(`Commute planner server listening on http://localhost:${PORT}`);
});

import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { itineraryRouter } from "./routes/itinerary.js";
import { chatRouter } from "./routes/chat.js";
import { billingRouter } from "./routes/billing.js";
import { startLiveFeed } from "./services/liveFeed.js";

const PORT = Number(process.env.PORT) || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.use("/api", itineraryRouter);
app.use("/api", chatRouter);
app.use("/api", billingRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

io.on("connection", (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);
  socket.on("disconnect", () => console.log(`[socket] client disconnected: ${socket.id}`));
});

startLiveFeed(io);

httpServer.listen(PORT, () => {
  console.log(`Commute planner server listening on http://localhost:${PORT}`);
});

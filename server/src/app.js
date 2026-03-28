import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import apiRoutes from "./routes/index.js";

const defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

function allowedOrigins() {
  if (process.env.CLIENT_ORIGIN?.trim()) {
    return [process.env.CLIENT_ORIGIN.trim()];
  }
  const multi = (process.env.CLIENT_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi.length) return multi;
  return defaultOrigins;
}

function corsMiddleware(req, res, next) {
  const origins = allowedOrigins();
  const requestOrigin = req.headers.origin;
  if (requestOrigin && origins.includes(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
  } else if (!requestOrigin && origins.length === 1) {
    res.setHeader("Access-Control-Allow-Origin", origins[0]);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
}

export function createApp() {
  const app = express();

  app.use(corsMiddleware);
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", apiRoutes);

  app.use(errorHandler);

  return app;
}

// HTTP transport: one JSON-RPC style endpoint over the Platform method table, plus static UI.
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DomainError } from "../core/kernel.ts";
import { METHODS, type Platform } from "../core/platform.ts";

export function createApp(platform: Platform, opts: { staticDir?: string } = {}) {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/methods", (_req, res) => res.json(Object.keys(METHODS)));

  app.post("/api/rpc/:method", (req, res) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const actor = platform.authenticate(token);
    try {
      const result = platform.call(req.params.method, actor, req.body ?? {});
      res.json({ result });
    } catch (err) {
      if (err instanceof DomainError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
        return;
      }
      console.error(err);
      res.status(500).json({ error: { code: "internal", message: "Internal error." } });
    }
  });

  const dir = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null;
  if (dir) {
    app.use(express.static(dir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dir, "index.html")));
  }
  return app;
}

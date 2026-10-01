import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Platform } from "../core/platform.ts";
import { processEmbargoes } from "../core/publication.ts";
import { createApp } from "./app.ts";

const dbPath = process.env.AXIOM_DB ?? "data/axiom.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const platform = new Platform({ path: dbPath });
const app = createApp(platform, { staticDir: "dist/web" });
const port = Number(process.env.PORT ?? 4400);

// Embargoes are released only with prior authorization and a fresh exposure check.
setInterval(() => {
  try {
    processEmbargoes(platform.k);
  } catch (err) {
    console.error("embargo processing failed", err);
  }
}, 60_000).unref();

app.listen(port, () => console.log(`axiom listening on http://localhost:${port} (db: ${dbPath})`));

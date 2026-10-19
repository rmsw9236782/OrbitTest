// Local development server only (Vercel does not use this file).
// Serves /public and routes POST /api/chat to api/chat.js.
// Usage: node dev-server.js   (reads GROQ_API_KEY / GROQ_MODEL from env or .env)

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./api/chat.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const PORT = Number(process.env.PORT) || 3000;

// Minimal .env loader (no dependencies).
const envFile = path.join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/chat") return handler(req, res);

    const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    }
  })
  .listen(PORT, () => {
    console.log(`Orbit running at http://localhost:${PORT}`);
    if (!process.env.GROQ_API_KEY) console.log("Note: GROQ_API_KEY is not set; /api/chat will return an error.");
  });

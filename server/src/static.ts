import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/**
 * Serves the built client (`client/dist`) so one process and one port runs the game
 * (ROADMAP M6). Hashed files under assets/ are cached forever; index.html never is.
 */
export function staticHandler(root: string): (req: IncomingMessage, res: ServerResponse) => void {
  const base = resolve(root);
  return (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    if (path === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    let file = normalize(join(base, path));
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(base, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const immutable = file.startsWith(join(base, "assets") + sep);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  };
}

/** STATIC_DIR, or client/dist next to this checkout if it has been built. */
export function defaultStaticDir(here: string): string | undefined {
  if (process.env.STATIC_DIR) return process.env.STATIC_DIR;
  for (const candidate of [resolve(here, "../../client/dist"), resolve(here, "../client/dist")]) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return undefined;
}

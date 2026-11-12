import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const root = import.meta.dirname;
const docsSrc = path.resolve(root, "docs");
const docsDist = path.resolve(root, "docs/.vitepress/dist");

function buildDocs(): Promise<number> {
  console.log("kairotron-docs: building VitePress site...");
  const child = spawn("node", ["node_modules/vitepress/bin/vitepress.js", "build", "docs"], {
    cwd: root,
    stdio: "inherit",
  });
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

function serveDocsFile(urlPath: string, res: ServerResponse): boolean {
  const rel = decodeURIComponent(urlPath.split("?")[0]!.replace(/^\/docs\/?/, ""));
  if (rel.split("/").includes("..")) return false;
  // cleanUrls: /docs/guide/concepts → guide/concepts.html, /docs/ → index.html
  const candidates =
    rel === ""
      ? ["index.html"]
      : [rel, `${rel}.html`, path.join(rel, "index.html")];
  const file = candidates
    .map((c) => path.join(docsDist, c))
    .find((c) => {
      try {
        return statSync(c).isFile();
      } catch {
        return false;
      }
    });
  if (!file) return false;
  res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
  return true;
}

function docsServe(): Plugin {
  return {
    name: "kairotron-docs",
    apply: "serve",
    configureServer(server) {
      if (!existsSync(path.join(docsDist, "index.html"))) void buildDocs();
      server.watcher.add(docsSrc);
      let timer: NodeJS.Timeout | undefined;
      server.watcher.on("all", (_event, file) => {
        const p = path.resolve(file);
        if (!p.startsWith(docsSrc) || p.startsWith(path.join(docsSrc, ".vitepress"))) return;
        clearTimeout(timer);
        timer = setTimeout(() => void buildDocs(), 1000);
      });
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url !== "/docs" && !url.startsWith("/docs/")) return next();
        res.setHeader("Cache-Control", "no-cache");
        if (serveDocsFile(url, res)) return;
        if (!existsSync(path.join(docsDist, "index.html"))) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end("<p>Docs are building… reload in a few seconds.</p>");
          return;
        }
        res.statusCode = 404;
        res.end("Not found in docs");
      });
    },
  };
}

function docsBundle(): Plugin {
  return {
    name: "kairotron-docs-bundle",
    apply: "build",
    async closeBundle() {
      const code = await buildDocs();
      if (code !== 0) throw new Error(`vitepress build failed (${code})`);
      const outDir = path.resolve(root, "dist/docs");
      await rm(outDir, { recursive: true, force: true });
      await cp(docsDist, outDir, { recursive: true });
    },
  };
}

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  plugins: [docsServe(), docsBundle()],
});

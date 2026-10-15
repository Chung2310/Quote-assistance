import { readFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { config } from "./config.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(moduleDirectory, "../../web");

export async function attachWeb(app: Express, httpServer: HttpServer): Promise<() => Promise<void>> {
  if (config.nodeEnv === "production") {
    const buildDirectory = path.join(webDirectory, "dist");
    app.use(express.static(buildDirectory));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path === "/api" || request.path.startsWith("/api/")) return next();
      response.sendFile(path.join(buildDirectory, "index.html"), (error) => {
        if (error) next(error);
      });
    });
    return async () => {};
  }

  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: path.join(webDirectory, "vite.config.ts"),
    configLoader: "runner",
    server: { middlewareMode: { server: httpServer } },
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.use(async (request, response, next) => {
    if (request.method !== "GET" || request.path === "/api" || request.path.startsWith("/api/")) return next();
    try {
      const template = await readFile(path.join(webDirectory, "index.html"), "utf8");
      const html = await vite.transformIndexHtml(request.originalUrl, template);
      response.status(200).type("html").send(html);
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      next(error);
    }
  });
  return () => vite.close();
}

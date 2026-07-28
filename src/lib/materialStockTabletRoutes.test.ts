import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { describe, it } from "node:test";
import express from "express";
import type { RequestHandler } from "express";
import { registerMaterialStockTabletRoutes } from "./materialStockTabletRoutes.js";
import { MATERIAL_STOCK_TABLET_SEARCH_PATH } from "./materialStockTabletTypes.js";

const root = process.cwd();

const denyAuth: RequestHandler = (_req, res) => {
  res.status(401).json({ error: "UNAUTHORIZED" });
};

describe("materialStockTabletRoutes", () => {
  it("exige autenticação (401) antes do handler", async () => {
    const app = express();
    const prisma = new Proxy(
      {},
      {
        get: () => {
          throw new Error("prisma must not run before auth");
        },
      }
    ) as any;
    registerMaterialStockTabletRoutes(
      app,
      { requireAppAuth: denyAuth, requireResource: () => denyAuth },
      { prisma }
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      const res = await fetch(
        `http://127.0.0.1:${addr.port}${MATERIAL_STOCK_TABLET_SEARCH_PATH}`
      );
      assert.equal(res.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it("APIs antigas de materials permanecem no server", () => {
    const server = readFileSync(join(root, "server.ts"), "utf8");
    assert.match(server, /app\.get\(\s*["']\/api\/materials["']/);
    assert.match(server, /app\.post\(\s*["']\/api\/materials["']/);
    assert.match(server, /app\.put\(\s*["']\/api\/materials\/:id["']/);
    assert.match(server, /registerMaterialStockTabletRoutes/);
  });
});

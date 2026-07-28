import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { describe, it } from "node:test";
import express from "express";
import type { RequestHandler } from "express";
import { ENGINEERING_RESOURCE_KEYS } from "./engineeringAccess.js";
import { registerMaterialStockTabletRoutes } from "./materialStockTabletRoutes.js";
import {
  MATERIAL_STOCK_TABLET_CONFERENCE_PATH,
  MATERIAL_STOCK_TABLET_HISTORY_PATH,
  MATERIAL_STOCK_TABLET_PARAMETERS_PATH,
  MATERIAL_STOCK_TABLET_SEARCH_PATH,
} from "./materialStockTabletTypes.js";

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
      {
        requireAppAuth: denyAuth,
        requireResource: () => denyAuth,
        getCurrentAppUser: async () => null,
      },
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

  it("conferência/parâmetros exigem update; histórico tem permissão própria view", () => {
    const calls: Array<{ resource: string; action?: string }> = [];
    const allow: RequestHandler = (_req, _res, next) => next();
    const app = express();
    registerMaterialStockTabletRoutes(
      app,
      {
        requireAppAuth: allow,
        requireResource: (resource, action) => {
          calls.push({ resource, action });
          return allow;
        },
        getCurrentAppUser: async () => ({
          id: "11111111-1111-4111-8111-111111111111",
          name: "Sessão",
        }),
      },
      {
        prisma: new Proxy(
          {},
          {
            get: () => {
              throw new Error("prisma stub — só valida guardas");
            },
          }
        ) as any,
      }
    );

    assert.ok(
      calls.some(
        (c) =>
          c.resource === ENGINEERING_RESOURCE_KEYS.materials && c.action === "update"
      ),
      "conferência/parâmetros exigem update"
    );
    assert.ok(
      calls.filter(
        (c) =>
          c.resource === ENGINEERING_RESOURCE_KEYS.materials && c.action === "view"
      ).length >= 2,
      "search + history exigem view"
    );

    const source = readFileSync(
      join(root, "src/lib/materialStockTabletRoutes.ts"),
      "utf8"
    );
    assert.match(source, /MATERIAL_STOCK_TABLET_CONFERENCE_PATH/);
    assert.match(source, /MATERIAL_STOCK_TABLET_PARAMETERS_PATH/);
    assert.match(source, /MATERIAL_STOCK_TABLET_HISTORY_PATH/);
    assert.match(source, /app\.patch\(/);
    assert.match(source, /Permissão própria desta API: somente leitura/);
    assert.match(source, /userId do body é ignorado/);
    assert.doesNotMatch(source, /app\.(put|delete|patch)\(\s*MATERIAL_STOCK_TABLET_HISTORY_PATH/);
    assert.equal(MATERIAL_STOCK_TABLET_CONFERENCE_PATH, "/api/materials/stock-tablet/conference");
    assert.equal(
      MATERIAL_STOCK_TABLET_PARAMETERS_PATH,
      "/api/materials/stock-tablet/:materialId/parameters"
    );
    assert.equal(
      MATERIAL_STOCK_TABLET_HISTORY_PATH,
      "/api/materials/stock-tablet/:materialId/history"
    );
  });

  it("APIs antigas de materials permanecem no server", () => {
    const server = readFileSync(join(root, "server.ts"), "utf8");
    assert.match(server, /app\.get\(\s*["']\/api\/materials["']/);
    assert.match(server, /app\.post\(\s*["']\/api\/materials["']/);
    assert.match(server, /app\.put\(\s*["']\/api\/materials\/:id["']/);
    assert.match(server, /registerMaterialStockTabletRoutes/);
  });
});

/**
 * Smoke HTTP das rotas críticas de Inteligência de Mercado.
 *
 * - Registrars modulares: monta Express sem listen/porta, auth que nega → 401.
 *   Prisma mockado (não deve ser chamado se auth for antes do handler).
 * - Rotas ainda inline em server.ts: assert estático de path + requireAppAuth
 *   (sem boot do server completo / sem DB real).
 *
 * Sucesso smoke: status 200/400/401/403, ou import sem crash.
 * 401/403 em rota autenticada conta como OK (gate de auth).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import express from "express";
import type { RequestHandler } from "express";
import { registerBrentCommodityRoutes } from "./brentCommodityRoutes.js";
import { registerPtaxSnapshotRoutes } from "./ptaxSnapshotRoutes.js";
import { registerMarketGlobalIndicatorsRoutes } from "./marketGlobalIndicatorsRoutes.js";
import { registerMaterialMarketAuditRoutes } from "./materialMarketAuditRoutes.js";
import { registerMaterialMarketIntelligenceExportRoutes } from "./materialMarketIntelligenceExportRoutes.js";
import { registerMaterialMarketQuoteAttachmentRoutes } from "./materialMarketQuoteAttachmentRoutes.js";
import { registerMaterialMarketQuoteGovernanceRoutes } from "./materialMarketQuoteGovernanceRoutes.js";
import { registerMaterialMarketQuoteReliabilityRoutes } from "./materialMarketQuoteReliabilityRoutes.js";
import { resetBrentCommoditySchedulerForTests } from "./brentCommodityJob.js";
import { resetPtaxSnapshotSchedulerForTests } from "./ptaxSnapshotJob.js";

process.env.BRENT_COMMODITY_SCHEDULER_ENABLED = "false";
process.env.PTAX_SNAPSHOT_SCHEDULER_ENABLED = "false";

const SAMPLE_MATERIAL_ID = "11111111-1111-4111-8111-111111111111";
const SAMPLE_QUOTE_ID = "22222222-2222-4222-8222-222222222222";
const SAMPLE_ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";

const SMOKE_OK = new Set([200, 400, 401, 403]);

type SmokeMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const denyAuth: RequestHandler = (_req, res) => {
  res.status(401).json({
    error: "UNAUTHORIZED",
    message: "Autenticação necessária.",
  });
};

function denyPermission(_permission: string): RequestHandler {
  return denyAuth;
}

function createMockPrisma(): any {
  const never = async () => {
    throw new Error("SMOKE: prisma must not be reached before auth gate");
  };
  return new Proxy(
    {},
    {
      get: () =>
        new Proxy(
          {},
          {
            get: () => never,
          }
        ),
    }
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

async function requestApp(
  app: express.Application,
  method: SmokeMethod,
  path: string,
  body?: unknown
): Promise<{ status: number; bodyText: string }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: payload
        ? { "content-type": "application/json", accept: "application/json" }
        : { accept: "application/json" },
      body: payload,
    });
    const bodyText = await res.text();
    return { status: res.status, bodyText };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

function assertSmokeStatus(label: string, status: number): void {
  assert.ok(
    SMOKE_OK.has(status),
    `${label}: status inesperado ${status} (aceitos: ${[...SMOKE_OK].join(",")})`
  );
}

function createMiModularApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const guards = {
    requireAppAuth: denyAuth,
    requirePermission: denyPermission,
    getCurrentAppUser: async () => null,
    hasPermission: () => false,
  };

  const prisma = createMockPrisma();

  registerBrentCommodityRoutes(app, {
    requireAppAuth: guards.requireAppAuth,
    requirePermission: guards.requirePermission,
  });

  registerPtaxSnapshotRoutes(app, {
    requireAppAuth: guards.requireAppAuth,
    requirePermission: guards.requirePermission,
  });

  registerMaterialMarketQuoteGovernanceRoutes(
    app,
    {
      requireAppAuth: guards.requireAppAuth,
      requirePermission: guards.requirePermission,
    },
    { prisma, getCurrentAppUser: guards.getCurrentAppUser }
  );

  registerMaterialMarketAuditRoutes(
    app,
    {
      requireAppAuth: guards.requireAppAuth,
      requirePermission: guards.requirePermission,
    },
    { prisma, getCurrentAppUser: guards.getCurrentAppUser }
  );

  registerMaterialMarketQuoteAttachmentRoutes(
    app,
    {
      requireAppAuth: guards.requireAppAuth,
      requirePermission: guards.requirePermission,
      getCurrentAppUser: guards.getCurrentAppUser,
      hasPermission: guards.hasPermission,
    },
    { prisma, isUuid }
  );

  registerMaterialMarketQuoteReliabilityRoutes(
    app,
    {
      requireAppAuth: guards.requireAppAuth,
      getCurrentAppUser: guards.getCurrentAppUser,
    },
    { prisma, isUuid }
  );

  registerMarketGlobalIndicatorsRoutes(app, {
    requireAppAuth: guards.requireAppAuth,
    requirePermission: guards.requirePermission,
  });

  registerMaterialMarketIntelligenceExportRoutes(
    app,
    {
      requireAppAuth: guards.requireAppAuth,
      requirePermission: guards.requirePermission,
    },
    { prisma }
  );

  return app;
}

after(() => {
  resetBrentCommoditySchedulerForTests();
  resetPtaxSnapshotSchedulerForTests();
});

describe("MI route smoke — modular registrars (HTTP 401 auth-gate)", () => {
  const app = createMiModularApp();

  const cases: Array<{ method: SmokeMethod; path: string; body?: unknown }> = [
    // Audit
    {
      method: "GET",
      path: `/api/materials/market-intelligence/${SAMPLE_MATERIAL_ID}/audit`,
    },
    {
      method: "PATCH",
      path: `/api/materials/market-intelligence/${SAMPLE_MATERIAL_ID}/quotes/${SAMPLE_QUOTE_ID}`,
      body: { unitPrice: 1 },
    },
    {
      method: "DELETE",
      path: `/api/materials/market-intelligence/${SAMPLE_MATERIAL_ID}/quotes/${SAMPLE_QUOTE_ID}`,
    },
    // Attachments
    {
      method: "GET",
      path: `/api/materials/market-intelligence/${SAMPLE_MATERIAL_ID}/quotes/${SAMPLE_QUOTE_ID}/attachments`,
    },
    {
      method: "GET",
      path: `/api/materials/market-intelligence/${SAMPLE_MATERIAL_ID}/quotes/${SAMPLE_QUOTE_ID}/attachments/${SAMPLE_ATTACHMENT_ID}/download`,
    },
    // Reliability
    {
      method: "PATCH",
      path: `/api/materials/market-intelligence/${SAMPLE_MATERIAL_ID}/quotes/${SAMPLE_QUOTE_ID}/reliability`,
      body: { level: "HIGH", justification: "smoke" },
    },
    // Export
    { method: "GET", path: "/api/materials/market-intelligence/export?format=csv" },
    {
      method: "POST",
      path: "/api/materials/market-intelligence/export",
      body: { format: "csv" },
    },
    // Brent
    { method: "GET", path: "/api/market-intelligence/commodities/brent/latest" },
    { method: "POST", path: "/api/market-intelligence/commodities/brent/collect" },
    // PTAX
    { method: "GET", path: "/api/market-intelligence/ptax/latest" },
    { method: "POST", path: "/api/market-intelligence/ptax/collect" },
    // Global indicators (home KPIs)
    { method: "GET", path: "/api/market/header-ticker" },
    { method: "GET", path: "/api/market-intelligence/global-indicators" },
    { method: "POST", path: "/api/market-intelligence/global-indicators/refresh" },
    // Governance (related quote lifecycle)
    {
      method: "POST",
      path: `/api/materials/market-intelligence/${SAMPLE_MATERIAL_ID}/quotes/${SAMPLE_QUOTE_ID}/submit-approval`,
      body: { reason: "smoke" },
    },
  ];

  for (const c of cases) {
    it(`${c.method} ${c.path} responde 401 (auth) sem crash`, async () => {
      const { status, bodyText } = await requestApp(app, c.method, c.path, c.body);
      assertSmokeStatus(`${c.method} ${c.path}`, status);
      assert.equal(status, 401, `${c.method} ${c.path} body=${bodyText.slice(0, 200)}`);
    });
  }

  it("audit routes NÃO registram duplicate alert-config (canonical fica em server.ts)", () => {
    const audit = read("src/lib/materialMarketAuditRoutes.ts");
    assert.doesNotMatch(audit, /alert-config/);
    assert.doesNotMatch(audit, /parseMaterialMarketAlertConfigPatch/);
  });
});

describe("MI route smoke — server.ts inline registration", () => {
  const server = () => read("server.ts");

  function assertRouteBlock(pathLiteral: string, extras: RegExp[] = []): void {
    const src = server();
    const idx = src.indexOf(`"${pathLiteral}"`);
    assert.ok(idx >= 0, `rota ausente em server.ts: ${pathLiteral}`);
    const block = src.slice(idx, idx + 420);
    assert.match(block, /requireAppAuth/);
    for (const re of extras) {
      assert.match(block, re, `falhou em ${pathLiteral}: ${re}`);
    }
  }

  it("home / monitored", () => {
    assertRouteBlock("/api/materials/market-intelligence/monitored", [
      /requirePermission\("materials\.view"\)/,
    ]);
  });

  it("detail / 360", () => {
    assertRouteBlock("/api/materials/market-intelligence/:materialId", [
      /requirePermission\("materials\.view"\)/,
    ]);
  });

  it("quotes GET", () => {
    assertRouteBlock("/api/materials/market-intelligence/:materialId/quotes", [
      /requirePermission\("materials\.view"\)/,
    ]);
  });

  it("quotes POST (materials.edit)", () => {
    const src = server();
    const first = src.indexOf('"/api/materials/market-intelligence/:materialId/quotes"');
    assert.ok(first >= 0);
    const second = src.indexOf(
      '"/api/materials/market-intelligence/:materialId/quotes"',
      first + 1
    );
    assert.ok(second > first, "POST quotes deve estar registrado após GET");
    // `app.post(` fica antes da string do path
    const block = src.slice(Math.max(0, second - 80), second + 420);
    assert.match(block, /app\.post\s*\(/);
    assert.match(block, /requireAppAuth/);
    assert.match(block, /requirePermission\("materials\.edit"\)/);
  });

  it("alert-config canonical (server.ts only)", () => {
    assertRouteBlock("/api/market-intelligence/alert-config/global", [
      /requireAppAuth/,
    ]);
    assertRouteBlock("/api/market-intelligence/alert-config/audit", [
      /requireAppAuth/,
    ]);
    assertRouteBlock(
      "/api/materials/market-intelligence/:materialId/alert-config",
      [/requireAppAuth/]
    );
    const audit = read("src/lib/materialMarketAuditRoutes.ts");
    assert.doesNotMatch(
      audit,
      /\/api\/materials\/market-intelligence\/:materialId\/alert-config/
    );
  });

  it("registrars MI estão wired no server", () => {
    const src = server();
    for (const name of [
      "registerBrentCommodityRoutes",
      "registerMaterialMarketAuditRoutes",
      "registerMaterialMarketQuoteAttachmentRoutes",
      "registerMaterialMarketQuoteReliabilityRoutes",
      "registerMaterialMarketIntelligenceExportRoutes",
      "registerMarketGlobalIndicatorsRoutes",
      "registerMaterialMarketQuoteGovernanceRoutes",
    ]) {
      assert.match(src, new RegExp(name));
    }
  });
});

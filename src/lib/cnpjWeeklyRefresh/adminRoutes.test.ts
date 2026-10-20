import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import type { RequestHandler } from "express";
import { hasPermission } from "@/src/lib/auth/appAuth.shared.js";
import {
  CNPJ_WEEKLY_REFRESH_MANAGE_PERMISSIONS,
  CNPJ_WEEKLY_REFRESH_VIEW_PERMISSIONS,
  registerCnpjWeeklyRefreshAdminRoutes,
} from "./adminRoutes.js";
import { createMemoryCnpjRefreshStore } from "./memoryStore.js";

function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function guards(permissions: string[]) {
  const requireAnyPermission = (keys: string[]): RequestHandler => (_req, res, next) => {
    if (keys.some((key) => permissions.includes(key))) return next();
    res.status(403).json({ error: "forbidden" });
  };
  return {
    requireAppAuth: ((_req, _res, next) => next()) as RequestHandler,
    requireAnyPermission,
    getCurrentAppUser: async () => ({ id: "admin-1" }),
  };
}

describe("acesso da consulta semanal", () => {
  it("não deixa o comercial comum executar a rotina", () => {
    assert.equal(
      hasPermission({ role: "SELLER", permissions: ["crm.view", "customers.view"] }, CNPJ_WEEKLY_REFRESH_MANAGE_PERMISSIONS[0]),
      false
    );
    assert.equal(
      hasPermission(
        { role: "ADMIN", permissions: [CNPJ_WEEKLY_REFRESH_MANAGE_PERMISSIONS[0]] },
        CNPJ_WEEKLY_REFRESH_MANAGE_PERMISSIONS[0]
      ),
      true
    );
  });

  it("bloqueia execução manual sem a permissão administrativa e aceita quem pode gerir", async () => {
    const store = createMemoryCnpjRefreshStore();
    const denied = express();
    denied.use(express.json());
    registerCnpjWeeklyRefreshAdminRoutes(denied, guards([CNPJ_WEEKLY_REFRESH_VIEW_PERMISSIONS[0]]), {
      store,
      env: { CNPJ_WEEKLY_REFRESH_ENABLED: "false" },
      startScheduler: false,
    });
    const deniedServer = await listen(denied);
    const forbidden = await fetch(`${deniedServer.base}/api/admin/cnpj-weekly-refresh/run`, { method: "POST" });
    assert.equal(forbidden.status, 403);
    const status = await fetch(`${deniedServer.base}/api/admin/cnpj-weekly-refresh/status`);
    assert.equal(status.status, 200);
    await deniedServer.close();

    const allowed = express();
    allowed.use(express.json());
    registerCnpjWeeklyRefreshAdminRoutes(allowed, guards([...CNPJ_WEEKLY_REFRESH_MANAGE_PERMISSIONS]), {
      store,
      env: { CNPJ_WEEKLY_REFRESH_ENABLED: "false" },
      startScheduler: false,
      runnerDeps: {
        store,
        config: {
          enabled: false,
          minIntervalMs: 0,
          timeoutMs: 1000,
          maxRetries: 0,
          backoffBaseMs: 1,
          backoffCapMs: 10,
          circuitFailureThreshold: 5,
          circuitPauseMs: 10,
          heartbeatStaleMs: 1000,
          maxItems: null,
        },
        fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
        sleep: async () => undefined,
      },
    });
    const allowedServer = await listen(allowed);
    const accepted = await fetch(`${allowedServer.base}/api/admin/cnpj-weekly-refresh/run`, { method: "POST" });
    assert.equal(accepted.status, 202);
    const body = (await accepted.json()) as { runId: string };
    assert.ok(body.runId);
    await allowedServer.close();
  });
});

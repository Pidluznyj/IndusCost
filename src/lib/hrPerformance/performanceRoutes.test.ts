import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, it } from "node:test";
import { emptyPerformanceDatabase, type PerformanceDatabase } from "./performanceState.js";
import { registerPerformanceRoutes } from "./performanceRoutes.js";
import { createDraftModel, publishModel } from "./performanceService.js";

async function request(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: payload,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

function appFor(input: { enabled: boolean; granted: string[]; denied?: string[]; actor?: string | null; scopeEmployee?: string | null }) {
  const app = express();
  app.use(express.json());
  let db = emptyPerformanceDatabase();
  const guard = (resource: string, action = "view") => (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${resource}:${action}`;
    if (input.denied?.includes(key)) return res.status(403).json({ error: "DENIED" });
    if (!input.granted.includes(key)) return res.status(403).json({ error: "FORBIDDEN" });
    next();
  };
  registerPerformanceRoutes(app, {
    enabled: () => input.enabled,
    options: {
      now: () => new Date("2026-10-16T15:00:00.000Z"),
      officialPublication: false,
      identityOtpEnabled: false,
      remindersEnabled: false,
      publicOrigin: "https://induscost.local",
    },
    store: { read: async () => db, write: async (next) => { db = next; } },
    requireAppAuth: (_req, _res, next) => next(),
    requireResource: guard,
    loadScope: async () => ({ accessScope: "DIRECT_REPORTS", actorEmployeeId: input.scopeEmployee ?? "bruno", teamIds: ["ana"] }),
    loadEmployees: async () => [],
    actorUserId: async () => input.actor ?? "user-1",
  });
  return { app, read: () => db, seed: (next: PerformanceDatabase) => { db = next; } };
}

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

describe("rotas de desempenho", () => {
  it("flag desligada esconde o módulo e o portal", async () => {
    const { app } = appFor({ enabled: false, granted: ["admin.employees.performance:view"] });
    const { server, port } = await listen(app);
    try {
      assert.equal((await request(port, "GET", "/api/hr/performance/feature-status")).json.enabled, false);
      assert.equal((await request(port, "GET", "/api/hr/performance/models")).status, 404);
      assert.equal((await request(port, "POST", "/api/public/performance/session", { token: "x" })).status, 404);
    } finally {
      server.close();
    }
  });

  it("nega gestão sem permissão, respeita deny e bloqueia IDOR do líder", async () => {
    const viewer = appFor({ enabled: true, granted: ["admin.employees.performance:view"] });
    const { server, port } = await listen(viewer.app);
    try {
      assert.equal((await request(port, "POST", "/api/hr/performance/models", { name: "Modelo" })).status, 403);
    } finally {
      server.close();
    }

    const denied = appFor({
      enabled: true,
      granted: ["admin.employees.performance:manage", "admin.employees.performance:view"],
      denied: ["admin.employees.performance:manage"],
    });
    const deniedServer = await listen(denied.app);
    try {
      assert.equal((await request(deniedServer.port, "POST", "/api/hr/performance/models", { name: "Modelo válido" })).json.error, "DENIED");
    } finally {
      deniedServer.server.close();
    }

    const leader = appFor({
      enabled: true,
      granted: ["admin.employees.performance:update"],
      scopeEmployee: "bruno",
    });
    const created = createDraftModel(emptyPerformanceDatabase(), { name: "Base", actorUserId: "rh" }, {
      now: () => new Date("2026-10-16T15:00:00.000Z"),
      officialPublication: true,
      identityOtpEnabled: false,
      remindersEnabled: false,
      publicOrigin: "https://induscost.local",
    });
    if (created.ok === false) throw new Error("modelo");
    const published = publishModel(created.db, { modelId: created.value.modelId, actorUserId: "rh" }, {
      now: () => new Date("2026-10-16T15:00:00.000Z"),
      officialPublication: true,
      identityOtpEnabled: false,
      remindersEnabled: false,
      publicOrigin: "https://induscost.local",
    });
    if (published.ok === false) throw new Error("publicar");
    published.db.assignments.push({
      id: "tarefa-alheia",
      participantId: "p",
      cycleId: "c",
      employeeId: "carla",
      kind: "LEADER",
      evaluatorEmployeeId: "outro",
      status: "NOT_STARTED",
      version: 1,
      revision: 1,
      supersedesId: null,
      active: true,
      submittedAt: null,
      assistedByUserId: null,
    });
    leader.seed(published.db);
    const leaderServer = await listen(leader.app);
    try {
      const forbidden = await request(leaderServer.port, "GET", "/api/hr/performance/assignments/tarefa-alheia");
      assert.equal(forbidden.status, 403);
      const queue = await request(leaderServer.port, "GET", "/api/hr/performance/team");
      assert.equal(queue.json.items.length, 0);
    } finally {
      leaderServer.server.close();
    }
  });

  it("OTP desligado não autentica o convite", async () => {
    const { app } = appFor({ enabled: true, granted: [] });
    const { server, port } = await listen(app);
    try {
      const session = await request(port, "POST", "/api/public/performance/session", { token: "inexistente" });
      assert.equal(session.json.ok, false);
      assert.equal(session.json.message.includes("token"), false);
      const verify = await request(port, "POST", "/api/public/performance/verify", { sessionToken: "abc", otp: "123456" });
      assert.equal(verify.json.ok, false);
    } finally {
      server.close();
    }
  });
});

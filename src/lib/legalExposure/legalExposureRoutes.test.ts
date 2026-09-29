import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import { registerLegalExposureRoutes } from "./legalExposureRoutes.js";
import { createLegalExposureService } from "./legalExposureService.server.js";
import { createMemoryExposureRepository } from "./legalExposureRepository.server.js";
import type { NormalizedSourceBatch } from "./legalExposureContracts.js";

function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

function appFor(permissions: Record<string, string[]>) {
  const calls = { external: 0 };
  const disabled = (source: NormalizedSourceBatch["source"]): NormalizedSourceBatch => ({
    source,
    outcome: "CONFIGURATION_ERROR",
    errorCode: "CONFIGURATION_ERROR",
    errorMessageSanitized: "desligado",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  });
  const service = createLegalExposureService({
    repository: createMemoryExposureRepository(),
    createId: (() => {
      let n = 0;
      return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    })(),
    now: () => new Date("2026-09-29T19:00:00.000Z"),
    runners: {
      domicilio: async () => {
        calls.external += 1;
        return {
          ...disabled("DOMICILIO"),
          outcome: "SUCCESS",
          errorCode: null,
          errorMessageSanitized: null,
          externalCall: true,
          communications: [
            {
              sourceCommunicationId: "comm-1",
              tenantId: "tenant-fixture",
              processNumber: "0001234-56.2024.5.09.0001",
              communicationType: "CITACAO",
              subject: "Citação fictícia",
              sourceStatus: "N",
              availableAt: "2026-09-29T19:00:00.000Z",
              scienceDeadlineAt: null,
              sourceScienceAt: null,
              tribunal: "TRT9",
              courtUnit: null,
              rawMetadata: { id: "comm-1" },
            },
          ],
        };
      },
      datajud: async () => disabled("DATAJUD"),
      djen: async () => disabled("DJEN"),
    },
  });
  const app = express();
  app.use(express.json());
  registerLegalExposureRoutes(app, {
    requireAppAuth: (_req, _res, next) => next(),
    requireResource: (resource, action = "view") => (_req, res, next) => {
      if (permissions[resource]?.includes(action)) return next();
      res.status(403).json({ error: "FORBIDDEN", resource, action });
    },
    getCurrentAppUser: async () => ({ id: "user-1" }),
    service,
  });
  return { app, calls, service };
}

const full = {
  "admin.exposure": ["view", "manage"],
  "admin.exposure.communications": ["view"],
  "admin.exposure.sources": ["view", "manage"],
  "admin.exposure.sync": ["execute"],
  "admin.exposure.certificates": ["view", "manage"],
  "admin.exposure.settings": ["view"],
};

describe("exposure routes", () => {
  it("nega dashboard sem a permissão do módulo", async () => {
    const { app } = appFor({});
    const started = await listen(app);
    try {
      const response = await fetch(`${started.base}/api/legal-exposure/dashboard`);
      assert.equal(response.status, 403);
    } finally {
      await started.close();
    }
  });

  it("cobre dashboard, processos, timeline, comunicações, fontes, sync, certidão e alerta", async () => {
    const { app, calls } = appFor(full);
    const started = await listen(app);
    try {
      const created = await fetch(`${started.base}/api/legal-exposure/entities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cnpj: "11.222.333/0001-81", legalName: "Industria Exemplo LTDA" }),
      });
      assert.equal(created.status, 201);
      const entity = (await created.json()) as { id: string };
      const dashboard = await fetch(`${started.base}/api/legal-exposure/dashboard`);
      const dashboardBody = (await dashboard.json()) as { emptyState: string; cards: { monitoredCases: number } };
      assert.equal(dashboard.status, 200);
      assert.match(dashboardBody.emptyState, /fontes consultadas/);
      assert.equal(dashboardBody.cards.monitoredCases, 0);

      const cases = await fetch(`${started.base}/api/legal-exposure/cases?page=1&pageSize=10`);
      assert.equal(cases.status, 200);
      const detail = await fetch(`${started.base}/api/legal-exposure/cases/missing`);
      assert.equal(detail.status, 404);
      const timeline = await fetch(`${started.base}/api/legal-exposure/cases/missing/timeline`);
      assert.equal(timeline.status, 404);
      const communications = await fetch(`${started.base}/api/legal-exposure/communications`);
      assert.equal(communications.status, 200);
      const sources = await fetch(`${started.base}/api/legal-exposure/sources/status`);
      const sourcesBody = (await sources.json()) as { configuration: { configured: boolean }[] };
      assert.equal(sources.status, 200);
      assert.equal(JSON.stringify(sourcesBody).includes("CLIENT_SECRET"), false);
      const preview = await fetch(`${started.base}/api/legal-exposure/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preview", source: "DATAJUD" }),
      });
      const previewBody = (await preview.json()) as { externalCall: boolean; mode: string };
      assert.equal(preview.status, 200);
      assert.equal(previewBody.mode, "preview");
      assert.equal(previewBody.externalCall, false);
      const sync = await fetch(`${started.base}/api/legal-exposure/entities/${entity.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "apply", source: "DOMICILIO" }),
      });
      const syncBody = (await sync.json()) as { externalCall: boolean };
      assert.equal(sync.status, 200);
      assert.equal(syncBody.externalCall, true);
      assert.equal(calls.external, 1);
      const certificate = await fetch(`${started.base}/api/legal-exposure/certificates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: entity.id,
          type: "CNDT",
          result: "NEGATIVE",
          notes: "Registro manual de fixture.",
        }),
      });
      assert.equal(certificate.status, 201);
      const listed = await fetch(`${started.base}/api/legal-exposure/certificates`);
      assert.equal(listed.status, 200);
      const alerts = await fetch(`${started.base}/api/legal-exposure/alerts?status=OPEN`);
      const alertPage = (await alerts.json()) as { items: { id: string }[] };
      assert.ok(alertPage.items[0], "alerta de citação");
      const ack = await fetch(`${started.base}/api/legal-exposure/alerts/${alertPage.items[0].id}/acknowledge`, {
        method: "POST",
      });
      assert.equal(ack.status, 200);
      const resolved = await fetch(`${started.base}/api/legal-exposure/alerts/${alertPage.items[0].id}/resolve`, {
        method: "POST",
      });
      assert.equal(resolved.status, 200);
    } finally {
      await started.close();
    }
  });
});

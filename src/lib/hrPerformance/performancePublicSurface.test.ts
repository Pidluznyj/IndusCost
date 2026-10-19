import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, it } from "node:test";
import {
  createPerformancePublicHostGuard,
  isPerformancePublicPathAllowed,
  isPerformancePublicRequest,
  resolvePerformancePublicSurfaceConfig,
} from "./performancePublicSurface.js";

describe("superfície pública do portal de desempenho", () => {
  it("sem PERFORMANCE_PUBLIC_HOSTS nada muda", () => {
    const config = resolvePerformancePublicSurfaceConfig({});
    assert.equal(isPerformancePublicRequest({ hostHeader: "avaliacao.exemplo.com" }, config), false);
  });

  it("allowlist fail-closed, sem travessia e sem bundle de dev em produção", () => {
    const prod = { allowDevAssets: false };
    assert.equal(isPerformancePublicPathAllowed("/avaliacao", prod), true);
    assert.equal(isPerformancePublicPathAllowed("/api/public/performance/form", prod), true);
    assert.equal(isPerformancePublicPathAllowed("/assets/performance-abc.js", prod), true);
    for (const blocked of ["/", "/login", "/api/auth/me", "/api/hr/performance/models", "/performance-cycle", "/assets/../api/auth/me", "/src/App.tsx", "/r"]) {
      assert.equal(isPerformancePublicPathAllowed(blocked, prod), false, blocked);
    }
    assert.equal(isPerformancePublicPathAllowed("/src/public-performance/main.tsx", { allowDevAssets: true }), true);
  });

  it("pela superfície pública só o portal responde e o cookie administrativo some", async () => {
    const app = express();
    app.use(createPerformancePublicHostGuard({ publicHosts: ["avaliacao.exemplo.com"], surfaceHeaderName: "x-perf-public", allowDevAssets: false }));
    app.get("/api/auth/me", (req, res) => res.json({ cookie: req.headers.cookie ?? null }));
    app.get("/api/public/performance/form", (req, res) => res.json({ cookie: req.headers.cookie ?? null }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      const headers = { "x-perf-public": "1", cookie: "induscost_session=abc; ic_perf_session=xyz" };
      const admin = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers });
      assert.equal(admin.status, 404);
      const portal = await fetch(`http://127.0.0.1:${port}/api/public/performance/form`, { headers });
      assert.equal(portal.status, 200);
      assert.equal((await portal.json()).cookie, "ic_perf_session=xyz");
      assert.match(portal.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
      const internal = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie: "induscost_session=abc" } });
      assert.equal((await internal.json()).cookie, "induscost_session=abc", "rede interna segue igual");
    } finally {
      server.close();
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approxJsonBytes,
  isDevPerfBaselineEnvEnabled,
  summarizeDevPerfSamples,
  type DevPerfEndpointSample,
} from "@/src/lib/devPerfBaseline.js";

describe("devPerfBaseline", () => {
  it("approxJsonBytes mede objeto simples", () => {
    const n = approxJsonBytes({ a: 1, b: "x" });
    assert.ok(n > 0);
  });

  it("summarize ordena por tempo e payload e detecta paths duplicados", () => {
    const samples: DevPerfEndpointSample[] = [
      {
        scenario: "a",
        method: "GET",
        path: "/api/finance/accounts-receivable/dashboard",
        status: 200,
        totalMs: 100,
        dbMs: 40,
        queryCount: 2,
        payloadBytesApprox: 1000,
        rowCountApprox: null,
      },
      {
        scenario: "b",
        method: "GET",
        path: "/api/finance/accounts-receivable/dashboard",
        status: 200,
        totalMs: 250,
        dbMs: 80,
        queryCount: 3,
        payloadBytesApprox: 5000,
        rowCountApprox: null,
      },
      {
        scenario: "c",
        method: "GET",
        path: "/api/finance/dre",
        status: 200,
        totalMs: 180,
        dbMs: 60,
        queryCount: 5,
        payloadBytesApprox: 2000,
        rowCountApprox: null,
      },
    ];
    const s = summarizeDevPerfSamples(samples);
    assert.equal(s.byTotalMs[0]?.scenario, "b");
    assert.equal(s.byPayload[0]?.scenario, "b");
    assert.equal(s.duplicatePaths[0]?.path, "/api/finance/accounts-receivable/dashboard");
    assert.equal(s.duplicatePaths[0]?.count, 2);
  });

  it("flag só liga com INDUSCOST_PERF_BASELINE=1 fora de production", () => {
    const prev = process.env.INDUSCOST_PERF_BASELINE;
    const prevNode = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "test";
      delete process.env.INDUSCOST_PERF_BASELINE;
      assert.equal(isDevPerfBaselineEnvEnabled(), false);
      process.env.INDUSCOST_PERF_BASELINE = "1";
      assert.equal(isDevPerfBaselineEnvEnabled(), true);
    } finally {
      if (prev === undefined) delete process.env.INDUSCOST_PERF_BASELINE;
      else process.env.INDUSCOST_PERF_BASELINE = prev;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
    }
  });
});

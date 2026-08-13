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

  /**
   * A flag é opt-in explícito em TODO ambiente — produção inclusive, onde a
   * instrumentação é justamente a que responde "onde o tempo foi parar".
   * A proteção deixou de ser o NODE_ENV e passou a ser exigir o valor "1".
   */
  function withEnv(
    nodeEnv: string | undefined,
    flag: string | undefined,
    run: () => void
  ): void {
    const prevFlag = process.env.INDUSCOST_PERF_BASELINE;
    const prevNode = process.env.NODE_ENV;
    try {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      if (flag === undefined) delete process.env.INDUSCOST_PERF_BASELINE;
      else process.env.INDUSCOST_PERF_BASELINE = flag;
      run();
    } finally {
      if (prevFlag === undefined) delete process.env.INDUSCOST_PERF_BASELINE;
      else process.env.INDUSCOST_PERF_BASELINE = prevFlag;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
    }
  }

  it("produção: DESLIGADA por padrão (sem a variável)", () => {
    withEnv("production", undefined, () => {
      assert.equal(isDevPerfBaselineEnvEnabled(), false);
    });
  });

  it("produção: LIGADA somente com a flag explícita = 1", () => {
    withEnv("production", "1", () => {
      assert.equal(isDevPerfBaselineEnvEnabled(), true);
    });
  });

  it("produção: qualquer valor diferente de '1' mantém DESLIGADA", () => {
    for (const value of ["0", "false", "true", "", " 1", "1 ", "yes", "ON"]) {
      withEnv("production", value, () => {
        assert.equal(
          isDevPerfBaselineEnvEnabled(),
          false,
          `o valor ${JSON.stringify(value)} não pode ligar a instrumentação`
        );
      });
    }
  });

  it("dev/test mantêm exatamente o comportamento anterior", () => {
    for (const env of ["test", "development", undefined]) {
      withEnv(env, undefined, () => {
        assert.equal(isDevPerfBaselineEnvEnabled(), false);
      });
      withEnv(env, "1", () => {
        assert.equal(isDevPerfBaselineEnvEnabled(), true);
      });
      withEnv(env, "0", () => {
        assert.equal(isDevPerfBaselineEnvEnabled(), false);
      });
    }
  });
});

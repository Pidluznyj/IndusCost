import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearDevPerfSamples,
  getDevPerfSamples,
  measureDevPerfPhase,
  measureDevPerfPhaseSync,
  measureDevPerfScenario,
  noteDevPerfRowCounts,
  runWithDevPerfContext,
} from "@/src/lib/devPerfBaseline.server.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("PERF 3.1 phases — no-op e isolamento", () => {
  it("sem store (flag/request off) measureDevPerfPhase é identidade", async () => {
    const value = await measureDevPerfPhase("arLoad", async () => 7);
    assert.equal(value, 7);
    assert.equal(measureDevPerfPhaseSync("buildDashboard", () => 9), 9);
  });

  it("com store registra fases e row counts sem payload", async () => {
    const measured = await runWithDevPerfContext(async () => {
      noteDevPerfRowCounts({ ar: 12, ap: 8, orders: 3 });
      await measureDevPerfPhase("arLoad", async () => {
        await new Promise((r) => setTimeout(r, 15));
        return "ok";
      });
      measureDevPerfPhaseSync("buildDashboard", () => 1);
      return { secret: "não deve ir para o sample" };
    });
    assert.equal(measured.result.secret, "não deve ir para o sample");
    assert.ok((measured.phases?.arLoad ?? 0) >= 10);
    assert.ok((measured.phases?.buildDashboard ?? 0) >= 0);
    assert.deepEqual(measured.rowCounts, { ar: 12, ap: 8, orders: 3 });
  });

  it("totalMs do cenário exclui o JSON.stringify extra de bytes", async () => {
    clearDevPerfSamples();
    const payload = { pad: "x".repeat(80_000) };
    const { sample } = await measureDevPerfScenario({
      scenario: "finance_cash_flow_dashboard",
      path: "/api/finance/cash-flow/dashboard",
      run: async () => payload,
    });
    assert.ok((sample.profilingSerializeMs ?? 0) >= 0);
    assert.ok(
      sample.totalMs < 50,
      `totalMs=${sample.totalMs} não deveria incluir stringify de profiling`
    );
    assert.match(sample.notes ?? "", /excluído de totalMs/);
    assert.match(sample.notes ?? "", /NÃO use totalMs-dbMs como CPU/);
    const dumped = JSON.stringify(getDevPerfSamples());
    assert.ok(!dumped.includes("x".repeat(80_000)));
    assert.doesNotMatch(dumped, /FASE 2C/);
  });
});

describe("PERF 3.1 — fiação Cash Flow Light Projection intacta", () => {
  it("ainda há exatamente 3 resolveCashFlowProjectionMode nas rotas", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeCashFlowRoutes.ts"),
      "utf8"
    );
    const ocorrencias = routes.split("resolveCashFlowProjectionMode()").length - 1;
    assert.equal(ocorrencias, 3);
  });

  it("artefatos novos de stats não usam o nome FASE 2C", () => {
    const stats = readFileSync(
      join(process.cwd(), "src/lib/finance/cashFlowPerfStats.ts"),
      "utf8"
    );
    const script = readFileSync(
      join(process.cwd(), "scripts/perf-cash-flow-baseline.ts"),
      "utf8"
    );
    assert.doesNotMatch(stats, /FASE 2C/);
    assert.doesNotMatch(script, /FASE 2C/);
    assert.match(script, /Cash Flow Light Projection \(PERF 2C\)/);
  });
});

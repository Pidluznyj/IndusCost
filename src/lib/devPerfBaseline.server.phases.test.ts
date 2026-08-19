import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearDevPerfSamples,
  computeUnaccountedWallMs,
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
    assert.equal(measured.accountedPhases, null);
    assert.equal(measured.accountedWallMs, 0);
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

  it("accountedWallMs soma só fases sequenciais; unaccountedWallMs não usa dbMs", async () => {
    clearDevPerfSamples();
    const { sample } = await measureDevPerfScenario({
      scenario: "finance_cash_flow_dashboard",
      path: "/api/finance/cash-flow/dashboard",
      run: async () => {
        await measureDevPerfPhase(
          "loadRows",
          async () => {
            await new Promise((r) => setTimeout(r, 35));
            await measureDevPerfPhase("arLoad", async () => {
              await new Promise((r) => setTimeout(r, 20));
            });
            await measureDevPerfPhase("orderProjection", async () => {
              await new Promise((r) => setTimeout(r, 15));
            });
          },
          { account: true }
        );
        measureDevPerfPhaseSync(
          "buildDashboard",
          () => {
            const until = Date.now() + 20;
            while (Date.now() < until) {
              /* busy-wait: fase síncrona visível */
            }
            return 1;
          },
          { account: true }
        );
        return { ok: true };
      },
    });

    assert.ok((sample.phases?.loadRows ?? 0) >= 60);
    assert.ok((sample.phases?.arLoad ?? 0) >= 15);
    assert.ok((sample.phases?.orderProjection ?? 0) >= 10);
    assert.ok((sample.phases?.buildDashboard ?? 0) >= 15);
    assert.equal(sample.accountedPhases?.arLoad, undefined);
    assert.equal(sample.accountedPhases?.orderProjection, undefined);
    assert.ok((sample.accountedPhases?.loadRows ?? 0) >= 60);
    assert.ok((sample.accountedPhases?.buildDashboard ?? 0) >= 15);

    const accountedSum = Object.values(sample.accountedPhases ?? {}).reduce(
      (acc, ms) => acc + ms,
      0
    );
    assert.equal(sample.accountedWallMs, Math.round(accountedSum * 100) / 100);
    assert.equal(
      sample.unaccountedWallMs,
      computeUnaccountedWallMs(sample.totalMs, sample.accountedWallMs ?? 0)
    );
    assert.ok(
      (sample.unaccountedWallMs ?? 99) < 30,
      `unaccountedWallMs=${sample.unaccountedWallMs} deveria ser residual, não o buraco de ~9s`
    );
    assert.notEqual(sample.unaccountedWallMs, sample.totalMs - (sample.dbMs ?? 0));
    assert.match(sample.notes ?? "", /unaccountedWallMs=totalMs-accountedWallMs \(NÃO usa dbMs\)/);
  });

  it("computeUnaccountedWallMs ignora dbMs", () => {
    assert.equal(computeUnaccountedWallMs(9480, 415), 9065);
    assert.equal(computeUnaccountedWallMs(100, 90), 10);
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

  it("runner e rotas usam o mesmo caminho timed* (não só o handler HTTP)", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeCashFlowRoutes.ts"),
      "utf8"
    );
    const script = readFileSync(
      join(process.cwd(), "scripts/perf-cash-flow-baseline.ts"),
      "utf8"
    );
    const annual = readFileSync(
      join(process.cwd(), "src/lib/financeExecutiveReportAnnualLoad.ts"),
      "utf8"
    );
    const spotlight = readFileSync(
      join(process.cwd(), "src/lib/financeCashFlowRawMaterialSpotlight.server.ts"),
      "utf8"
    );
    const timed = readFileSync(
      join(process.cwd(), "src/lib/finance/cashFlowPerfTimed.server.ts"),
      "utf8"
    );
    for (const nome of [
      "timedBuildDashboard",
      "timedBuildAnnual",
      "timedFilterRadarPortfolio",
      "timedBuildRadar",
      "timedAssembleDashboardPayload",
    ]) {
      assert.match(routes, new RegExp(nome));
      assert.match(script, new RegExp(`${nome}\\(`));
      assert.match(timed, new RegExp(`export function ${nome}`));
    }
    assert.doesNotMatch(script, /buildFinanceCashFlowDashboard\(/);
    assert.doesNotMatch(script, /buildCashFlowAnnualComparison\(/);
    assert.doesNotMatch(script, /filterDailyRadarPortfolioRows\(/);
    assert.doesNotMatch(script, /buildFinanceCashFlowDailyRadar\(/);
    assert.match(routes, /measureDevPerfPhase\(\s*"loadRows"/);
    assert.match(annual, /measureDevPerfPhase\(\s*"loadRows"/);
    assert.match(spotlight, /measureDevPerfPhase\(\s*"spotlight"/);
    assert.match(script, /CASH_FLOW_PERF_SINGLE_COMMAND_NOTE/);
    assert.match(script, /já mede legacy \+ light/);
    assert.match(script, /Não envolva este comando em dois cenários externos/);
  });
});

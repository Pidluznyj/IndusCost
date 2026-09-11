import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getModulePath, NAVIGATION_GROUPS } from "@/src/lib/navigationGroups.js";
import { canAccessModule, MODULE_LABELS } from "@/src/lib/modulePermissions.js";
import { FINANCE_MODULE_PILOT_ENDPOINTS } from "@/src/lib/financeModulesAccess.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("financeProfitCashAnalysis wiring", () => {
  it("menu: profit-cash é o primeiro item do Financeiro", () => {
    const group = NAVIGATION_GROUPS.find((g) => g.id === "financeiro");
    assert.ok(group);
    assert.equal(group!.itemIds[0], "profit-cash");
    assert.equal(getModulePath("profit-cash"), "/finance/lucro-caixa");
    assert.equal(MODULE_LABELS["profit-cash"], "Lucro x Caixa");
  });

  it("canAccessModule aceita bags oficiais", () => {
    assert.equal(
      canAccessModule("profit-cash", { hasPermission: (k) => k === "finance.dre.view" }),
      true
    );
    assert.equal(canAccessModule("profit-cash", { hasPermission: () => false }), false);
  });

  it("App registra rota standalone antes de finance/*", () => {
    const app = readSrc("src/App.tsx");
    assert.match(app, /finance\/lucro-caixa/);
    assert.match(app, /FinanceProfitCashAnalysisPage/);
    const lucroIdx = app.indexOf('path="finance/lucro-caixa"');
    const financeStarIdx = app.indexOf('path="finance/*"');
    assert.ok(lucroIdx > 0 && financeStarIdx > lucroIdx);
  });

  it("API registrada no server e no pilot endpoints", () => {
    const server = readSrc("server.ts");
    assert.match(server, /registerFinanceProfitCashAnalysisRoutes/);
    const routes = readSrc("src/lib/financeProfitCashAnalysisRoutes.ts");
    assert.match(routes, /\/api\/finance\/profit-cash-analysis/);
    assert.match(routes, /buildProfitCashAnalysis/);
    assert.ok(
      FINANCE_MODULE_PILOT_ENDPOINTS.some(
        (e) => e.path === "/api/finance/profit-cash-analysis"
      )
    );
  });

  it("orquestração reutiliza fontes oficiais sem recalcular DRE/CF", () => {
    const server = readSrc("src/lib/financeProfitCashAnalysis.server.ts");
    assert.match(server, /buildFinanceDreReport/);
    assert.match(server, /buildFinanceDreCashBridgeReport/);
    assert.match(server, /buildFinanceCashFlowDashboard/);
    assert.doesNotMatch(server, /buildFinanceDreMath|recalculateDre/);
    const core = readSrc("src/lib/financeProfitCashAnalysisCore.ts");
    assert.match(core, /assembleProfitCashAnalysis/);
    assert.match(core, /dre\.kpis\.lucroLiquidoAproximado/);
  });

  it("link DRE preserva year/month/company na query", () => {
    const page = readSrc("src/components/finance/FinanceManagerialDrePage.tsx");
    assert.match(page, /finance-dre-profit-cash-link/);
    assert.match(page, /Entender por que o lucro não virou caixa/);
    assert.match(page, /\/finance\/lucro-caixa/);
    assert.match(page, /appliedFilters\.year/);
    assert.match(page, /appliedFilters\.month/);
    assert.match(page, /appliedFilters\.company/);
  });

  it("página UI não recalcula e sem personagem/mascote", () => {
    const page = readSrc(
      "src/components/finance/profit-cash/FinanceProfitCashAnalysisPage.tsx"
    );
    assert.match(page, /profit-cash-analysis/);
    assert.match(page, /useSearchParams/);
    assert.doesNotMatch(page, /personagem|mascote|mascot|character/i);
    assert.doesNotMatch(page, /lucroLiquidoAproximado\s*[-+*/]|gapToExplain\s*=/);
    assert.match(page, /payload\.summary\.cards/);
    assert.match(page, /FinanceBiDashboardShell/);
  });
});

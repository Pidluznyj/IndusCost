import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FINANCE_DRE_CASH_BRIDGE_COVERAGE,
  UNAVAILABLE_BANK_CASH_REASON,
} from "@/src/lib/financeDreCashBridgeCoverage.js";
import {
  buildCashBridgeExplanation,
  computeCashBridgeMateriality,
  computeCashBridgeResidual,
  computeWorkingCapitalEffects,
  effectFromBalanceDelta,
  finalizeCashBridgeReconciliation,
  formatCashBridgeAccountingMoney,
  resolveIsReconciled,
  sumExplainedCashVariation,
} from "@/src/lib/financeDreCashBridgeMath.js";
import type { CashBridgeLine } from "@/src/lib/financeDreCashBridgeTypes.js";
import { FINANCE_MODULE_PILOT_ENDPOINTS } from "@/src/lib/financeModulesAccess.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function line(
  partial: Pick<CashBridgeLine, "id" | "cashEffect" | "includeInExplained"> &
    Partial<CashBridgeLine>
): CashBridgeLine {
  return {
    label: partial.id,
    openingBalance: null,
    closingBalance: null,
    classification: partial.classification ?? "unavailable",
    missingReason: partial.missingReason ?? null,
    criteria: partial.criteria ?? "",
    sources: partial.sources ?? [],
    limitations: partial.limitations ?? [],
    lastSyncedAt: null,
    ...partial,
  };
}

describe("financeDreCashBridge math", () => {
  it("lucro positivo na linha DRE; caixa real null → canReconcile false sem residual inventado", () => {
    const lines = [
      line({
        id: "dre_net_result",
        cashEffect: 125_000,
        includeInExplained: true,
        classification: "available",
      }),
      line({
        id: "accounts_receivable",
        cashEffect: null,
        includeInExplained: true,
        classification: "unavailable",
      }),
    ];
    const result = finalizeCashBridgeReconciliation({
      canReconcile: false,
      actualCashVariation: null,
      lines,
      receitaLiquida: 1_000_000,
      hasPartialData: true,
    });
    assert.equal(result.explainedCashVariation, 125_000);
    assert.equal(result.residual, null);
    assert.equal(result.isReconciled, false);
    assert.equal(result.badge, "partial_data");
  });

  it("prejuízo (valor negativo) formatado entre parênteses e classificado", () => {
    const formatted = formatCashBridgeAccountingMoney(-42_500.5);
    assert.match(formatted, /^\(R\$/);
    assert.match(formatted, /42\.500,50\)$/);
    const explanation = buildCashBridgeExplanation({
      dreNetResult: -10_000,
      canReconcile: false,
      actualCashVariation: null,
      explainedCashVariation: -10_000,
      residual: null,
      companyLabel: "Todas",
      periodLabel: "Junho/2026",
    });
    assert.match(explanation, /prejuízo líquido aproximado/);
    assert.match(explanation, /ausência de caixa histórico|não possui saldo bancário/i);
  });

  it("materialidade com e sem receita líquida", () => {
    const withRevenue = computeCashBridgeMateriality(200_000);
    assert.equal(withRevenue.threshold, 2000);
    assert.equal(withRevenue.missingRevenueWarning, false);

    const floor = computeCashBridgeMateriality(50_000);
    assert.equal(floor.threshold, 1000);

    const missing = computeCashBridgeMateriality(null);
    assert.equal(missing.threshold, 1000);
    assert.equal(missing.missingRevenueWarning, true);
  });

  it("residual só calculado quando actualCashVariation é numérico", () => {
    assert.equal(computeCashBridgeResidual(null, 100), null);
    assert.equal(computeCashBridgeResidual(150, null), null);
    assert.equal(computeCashBridgeResidual(150, 100), 50);
    assert.equal(computeCashBridgeResidual(80, 100), -20);
  });

  it("indisponível ≠ zero (null preservado)", () => {
    assert.equal(effectFromBalanceDelta(null, 10, "asset"), null);
    assert.equal(effectFromBalanceDelta(10, null, "liability"), null);
    const wc = computeWorkingCapitalEffects({
      accountsReceivableOpening: null,
      accountsReceivableClosing: null,
      inventoryOpening: null,
      inventoryClosing: null,
      payablesOpening: null,
      payablesClosing: null,
    });
    assert.equal(wc.total, null);
    assert.equal(formatCashBridgeAccountingMoney(null), "—");
    assert.notEqual(formatCashBridgeAccountingMoney(null), formatCashBridgeAccountingMoney(0));
  });

  it("fixtures de sinal: CR/estoque/fornecedores", () => {
    // CR sobe → efeito negativo no caixa
    assert.equal(effectFromBalanceDelta(100, 130, "asset"), -30);
    // Estoque cai → efeito positivo
    assert.equal(effectFromBalanceDelta(50, 20, "asset"), 30);
    // Fornecedores sobem → efeito positivo
    assert.equal(effectFromBalanceDelta(80, 100, "liability"), 20);

    const wc = computeWorkingCapitalEffects({
      accountsReceivableOpening: 100,
      accountsReceivableClosing: 130,
      inventoryOpening: 50,
      inventoryClosing: 20,
      payablesOpening: 80,
      payablesClosing: 100,
    });
    assert.equal(wc.accountsReceivable, -30);
    assert.equal(wc.inventory, 30);
    assert.equal(wc.operationalPayables, 20);
    assert.equal(wc.total, 20);
  });

  it("isReconciled só com canReconcile e residual dentro da materialidade", () => {
    assert.equal(
      resolveIsReconciled({
        canReconcile: false,
        residual: 0,
        materialityThreshold: 1000,
      }),
      false
    );
    assert.equal(
      resolveIsReconciled({
        canReconcile: true,
        residual: 500,
        materialityThreshold: 1000,
      }),
      true
    );
    assert.equal(
      resolveIsReconciled({
        canReconcile: true,
        residual: 1500,
        materialityThreshold: 1000,
      }),
      false
    );
  });

  it("soma explained ignora null e linhas fora da fórmula", () => {
    const sum = sumExplainedCashVariation([
      line({ id: "dre_net_result", cashEffect: 10, includeInExplained: true }),
      line({ id: "accounts_receivable", cashEffect: null, includeInExplained: true }),
      line({
        id: "actual_cash_variation",
        cashEffect: 999,
        includeInExplained: false,
      }),
    ]);
    assert.equal(sum, 10);
  });
});

describe("financeDreCashBridge coverage & wiring", () => {
  it("matriz de cobertura documenta caixa bancário unavailable", () => {
    const bank = FINANCE_DRE_CASH_BRIDGE_COVERAGE.find((c) => c.componentId === "bank_cash");
    assert.ok(bank);
    assert.equal(bank?.status, "unavailable");
    assert.match(UNAVAILABLE_BANK_CASH_REASON, /hasInitialBankBalance/);
  });

  it("rota, permissão e página com aba Ponte", () => {
    const routes = readSrc("src/lib/financeDreRoutes.ts");
    assert.match(routes, /\/api\/finance\/dre\/cash-bridge/);
    assert.match(routes, /buildFinanceDreCashBridgeReport/);

    assert.ok(
      FINANCE_MODULE_PILOT_ENDPOINTS.some(
        (e) => e.path === "/api/finance/dre/cash-bridge" && e.resourceKey === "finance.dre"
      )
    );

    const contract = readSrc("src/lib/security/permissionContract/resources.ts");
    assert.match(contract, /\/api\/finance\/dre\/cash-bridge/);

    const page = readSrc("src/components/finance/FinanceManagerialDrePage.tsx");
    assert.match(page, /Ponte Lucro/);
    assert.match(page, /FinanceDreCashBridgePanel/);
    assert.match(page, /getFinanceDreCashBridgeApiPath/);
    assert.match(page, /pageTab !== "cash-bridge"/);

    const panel = readSrc("src/components/finance/dre/FinanceDreCashBridgePanel.tsx");
    assert.match(panel, /Variação do caixa indisponível/);
    assert.match(panel, /Indisponível/);
    assert.match(panel, /formatCashBridgeAccountingMoney/);
  });

  it("serviço reutiliza buildFinanceDreReport e não inventa caixa real", () => {
    const server = readSrc("src/lib/financeDreCashBridge.server.ts");
    assert.match(server, /buildFinanceDreReport/);
    assert.match(server, /canReconcile = false/);
    assert.match(server, /actualCashVariation: number \| null = null/);
    assert.match(server, /implementationStatus: "partial"/);
    assert.doesNotMatch(server, /hasInitialBankBalance:\s*true/);
  });
});

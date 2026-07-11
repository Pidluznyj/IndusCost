import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPeriodPresetToFilters,
  buildPortfolioIntelligenceFilterChips,
  countActivePortfolioIntelligenceFilters,
  createDefaultPortfolioIntelligenceUiFilters,
  portfolioIntelligenceUiFiltersToQueryArgs,
  resolvePortfolioIntelligencePeriodPreset,
} from "./portfolioIntelligenceFilters";
import { buildPortfolioIntelligenceListQuery } from "@/src/lib/financePortfolioReconciliationClient";
import { filterMaturityOrders } from "./portfolioMaturityAnalytics";
import type { PortfolioMaturityOrderRow } from "./portfolioMaturityAnalytics";

function baseRow(
  partial: Partial<PortfolioMaturityOrderRow> &
    Pick<PortfolioMaturityOrderRow, "orderCode" | "orderValue" | "statusPrincipal">
): PortfolioMaturityOrderRow {
  return {
    salesOrderId: partial.salesOrderId ?? partial.orderCode,
    orderCode: partial.orderCode,
    externalSalesOrderId: partial.externalSalesOrderId ?? null,
    customerName: partial.customerName ?? "Cliente",
    customerExternalId: partial.customerExternalId ?? 200,
    customerId: partial.customerId ?? null,
    sellerName: partial.sellerName ?? null,
    sellerExternalId: partial.sellerExternalId ?? null,
    sellerId: partial.sellerId ?? null,
    companyId: partial.companyId ?? null,
    issueDate: partial.issueDate ?? "2026-01-15",
    expectedDeliveryDate: partial.expectedDeliveryDate ?? "2026-03-01",
    nfeDate: partial.nfeDate ?? null,
    stockDocumentDate: partial.stockDocumentDate ?? null,
    receivableDueDate: partial.receivableDueDate ?? null,
    receivableSettlementDate: partial.receivableSettlementDate ?? null,
    forecastDate: partial.forecastDate ?? "2026-03-01",
    updatedAt: partial.updatedAt ?? "2026-07-01",
    orderValue: partial.orderValue,
    receivableTotalValue: partial.receivableTotalValue ?? 0,
    receivedValue: partial.receivedValue ?? 0,
    openReceivableValue: partial.openReceivableValue ?? 0,
    nfeHeaderValue: partial.nfeHeaderValue ?? 0,
    stockDocumentValue: partial.stockDocumentValue ?? 0,
    itemizedAllocatedValue: partial.itemizedAllocatedValue ?? 0,
    statusPrincipal: partial.statusPrincipal,
    tagsAlerta: partial.tagsAlerta ?? [],
    confidenceScore: partial.confidenceScore ?? 40,
    confidenceLabel: partial.confidenceLabel ?? "BAIXA",
    confidenceReasons: [],
    recommendedAction: "",
    executiveSummary: "",
    daysSinceIssue: null,
    daysSinceExpected: null,
    nextRelevantDate: null,
    mainReason: "",
    evidenceFlags: partial.evidenceFlags ?? {
      hasNfe: false,
      hasStockDocument: false,
      hasAllocatedStockDocument: false,
      hasReceivable: false,
      hasReceived: false,
      hasOpenReceivable: false,
    },
    forecastSource: "ORDER",
    factStatus: "ORDER_ONLY",
    productExternalIds: partial.productExternalIds ?? [],
    financialStatus: partial.financialStatus ?? null,
    operationalStatus: partial.operationalStatus ?? null,
    fulfillmentPercent: partial.fulfillmentPercent ?? null,
    excessQuantity: partial.excessQuantity ?? 0,
    estimatedExcessValue: partial.estimatedExcessValue ?? 0,
    valueOutsideOrder: partial.valueOutsideOrder ?? 0,
    nfeHeaderNotAttributed: partial.nfeHeaderNotAttributed ?? 0,
    fulfillmentAvailable: partial.fulfillmentAvailable ?? false,
  };
}

describe("portfolioIntelligenceFilters", () => {
  it("atalhos de período geram from/to", () => {
    const today = new Date(2026, 6, 10); // 10 jul 2026
    const thisMonth = resolvePortfolioIntelligencePeriodPreset("this_month", today);
    assert.deepEqual(thisMonth, { from: "2026-07-01", to: "2026-07-31" });

    const next30 = resolvePortfolioIntelligencePeriodPreset("next_30", today);
    assert.deepEqual(next30, { from: "2026-07-10", to: "2026-08-09" });

    const overdue = resolvePortfolioIntelligencePeriodPreset("overdue", today);
    assert.deepEqual(overdue, { from: "", to: "2026-07-09" });
  });

  it("próximos dias força eixo forecast se estava em emissão", () => {
    const base = createDefaultPortfolioIntelligenceUiFilters();
    base.dateAxis = "ORDER_ISSUE_DATE";
    const next = applyPeriodPresetToFilters(base, "next_30");
    assert.equal(next.dateAxis, "FORECAST_DATE");
    assert.ok(next.from);
    assert.ok(next.to);
  });

  it("query builder envia filtros avançados e evidências", () => {
    const filters = createDefaultPortfolioIntelligenceUiFilters({
      customerExternalId: "200",
    });
    filters.statusPrincipal = "CARTEIRA_VENCIDA_BLOQUEADA";
    filters.financialStatus = "FIN_CR_ABERTO";
    filters.operationalStatus = "OP_PARCIALMENTE_ATENDIDO";
    filters.operationalAlert = "PRODUTO_FORA_DO_PEDIDO";
    filters.confidenceLabel = "MUITO_BAIXA";
    filters.sellerName = "João";
    filters.companyId = "co-1";
    filters.orderCode = "PD 02159";
    filters.productExternalId = "9001";
    filters.dateAxis = "ORDER_ISSUE_DATE";
    filters.from = "2026-01-01";
    filters.to = "2026-12-31";
    filters.onlyWithoutNfe = true;
    filters.onlyWithoutReceivable = true;
    filters.minValue = "1000";
    filters.maxValue = "500000";

    const qs = buildPortfolioIntelligenceListQuery(
      portfolioIntelligenceUiFiltersToQueryArgs(filters, { runId: "run-1", pageSize: 200 })
    );
    const params = new URLSearchParams(qs);
    assert.equal(params.get("customerExternalId"), "200");
    assert.equal(params.get("statusPrincipal"), "CARTEIRA_VENCIDA_BLOQUEADA");
    assert.equal(params.get("financialStatus"), "FIN_CR_ABERTO");
    assert.equal(params.get("operationalStatus"), "OP_PARCIALMENTE_ATENDIDO");
    assert.equal(params.get("operationalAlert"), "PRODUTO_FORA_DO_PEDIDO");
    assert.match(params.get("tagsAlerta") ?? "", /PRODUTO_FORA_DO_PEDIDO/);
    assert.equal(params.get("confidenceLabel"), "MUITO_BAIXA");
    assert.equal(params.get("sellerName"), "João");
    assert.equal(params.get("companyId"), "co-1");
    assert.equal(params.get("orderCode"), "PD 02159");
    assert.equal(params.get("productExternalId"), "9001");
    assert.equal(params.get("dateAxis"), "ORDER_ISSUE_DATE");
    assert.equal(params.get("from"), "2026-01-01");
    assert.equal(params.get("to"), "2026-12-31");
    assert.equal(params.get("onlyWithoutNfe"), "true");
    assert.equal(params.get("onlyWithoutReceivable"), "true");
    assert.equal(params.get("minValue"), "1000");
    assert.equal(params.get("maxValue"), "500000");
    assert.equal(params.get("pageSize"), "200");
  });

  it("chips exibem filtros aplicados e limpar zera o estado", () => {
    const filters = createDefaultPortfolioIntelligenceUiFilters({
      customerExternalId: "200",
    });
    filters.operationalStatus = "OP_PARCIALMENTE_ATENDIDO";
    filters.operationalAlert = "PRODUTO_FORA_DO_PEDIDO";
    filters.periodPreset = "next_30";
    filters.from = "2026-07-10";
    filters.to = "2026-08-09";

    const chips = buildPortfolioIntelligenceFilterChips(filters, undefined, {
      customerNameByExternalId: { "200": "Britânia" },
    });
    const labels = chips.map((c) => c.label);
    assert.ok(labels.some((l) => l === "Cliente: Britânia"));
    assert.ok(labels.some((l) => l === "Status operacional: Parcialmente atendido"));
    assert.ok(labels.some((l) => l === "Alerta: Produto fora do pedido"));
    assert.ok(labels.some((l) => l === "Período: Próximos 30 dias"));
    assert.ok(countActivePortfolioIntelligenceFilters(filters) >= 4);

    const cleared = createDefaultPortfolioIntelligenceUiFilters();
    assert.equal(countActivePortfolioIntelligenceFilters(cleared), 0);
    const clearedChips = buildPortfolioIntelligenceFilterChips(cleared);
    assert.ok(!clearedChips.some((c) => c.label.startsWith("Cliente:")));
    assert.ok(!clearedChips.some((c) => c.label.startsWith("Status operacional:")));
    assert.ok(!clearedChips.some((c) => c.label.startsWith("Alerta:")));
    assert.ok(!clearedChips.some((c) => c.label.startsWith("Período:")));
  });

  it("filterMaturityOrders respeita status financeiro/operacional e alerta operacional", () => {
    const rows = [
      baseRow({
        orderCode: "PD A",
        orderValue: 10,
        statusPrincipal: "CR_ABERTO",
        financialStatus: "FIN_CR_ABERTO",
        operationalStatus: "OP_PARCIALMENTE_ATENDIDO",
        tagsAlerta: ["PRODUTO_FORA_DO_PEDIDO"],
      }),
      baseRow({
        orderCode: "PD B",
        orderValue: 20,
        statusPrincipal: "CARTEIRA_FUTURA_PROVAVEL",
        financialStatus: "FIN_SEM_CR",
        operationalStatus: "OP_NAO_ATENDIDO",
        tagsAlerta: [],
      }),
    ];
    const filtered = filterMaturityOrders(rows, {
      financialStatus: "FIN_CR_ABERTO",
      operationalStatus: "OP_PARCIALMENTE_ATENDIDO",
      operationalAlert: "PRODUTO_FORA_DO_PEDIDO",
    }, []);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.orderCode, "PD A");
  });

  it("atalhos rápidos mapeiam status/confiança/tags na query", () => {
    const filters = createDefaultPortfolioIntelligenceUiFilters();
    filters.onlyFuturePortfolio = true;
    filters.onlyTechnicalDivergence = true;
    filters.onlyVeryLowConfidence = true;
    const args = portfolioIntelligenceUiFiltersToQueryArgs(filters);
    assert.equal(args.statusPrincipal, "CARTEIRA_FUTURA_PROVAVEL");
    assert.equal(args.confidenceLabel, "MUITO_BAIXA");
    assert.match(args.tagsAlerta, /DIVERGENCIA_TECNICA/);
  });

  it("filterMaturityOrders respeita evidências sem NF/CR", () => {
    const rows = [
      baseRow({
        orderCode: "PD A",
        orderValue: 10,
        statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA",
        evidenceFlags: {
          hasNfe: false,
          hasStockDocument: false,
          hasAllocatedStockDocument: false,
          hasReceivable: false,
          hasReceived: false,
          hasOpenReceivable: false,
        },
      }),
      baseRow({
        orderCode: "PD B",
        orderValue: 20,
        statusPrincipal: "CR_ABERTO",
        evidenceFlags: {
          hasNfe: true,
          hasStockDocument: true,
          hasAllocatedStockDocument: true,
          hasReceivable: true,
          hasReceived: false,
          hasOpenReceivable: true,
        },
      }),
    ];
    const warnings: string[] = [];
    const filtered = filterMaturityOrders(
      rows,
      { onlyWithoutNfe: true, onlyWithoutReceivable: true },
      warnings
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.orderCode, "PD A");
  });
});

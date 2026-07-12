import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptOrderToCashAuditFactsToPortfolioFacts,
  applyOrderToCashStageStatusOverrides,
  mapOrderToCashStageToMaturityStatus,
  ORDER_TO_CASH_AUDIT_CHAIN_DISCLAIMER,
  type OrderToCashAuditFactAdapterInput,
} from "./orderToCashAuditToPortfolioFactsAdapter.js";
import type { PortfolioMaturityOrderRow } from "./portfolioMaturityAnalytics.js";

function o2cFact(
  partial: Partial<OrderToCashAuditFactAdapterInput> & { id: string }
): OrderToCashAuditFactAdapterInput {
  return {
    runId: "41c2470a-b685-4765-a954-77110fd8cf5c",
    salesOrderId: "so-1",
    externalSalesOrderId: 1,
    orderCode: "PD 1",
    orderIssueDate: "2026-01-10",
    orderExpectedDeliveryDate: "2026-02-10",
    orderNetValue: 1000,
    customerId: "c1",
    externalCustomerId: 200,
    customerName: "Britânia",
    salesOrderItemId: "item-1",
    externalSalesOrderItemId: 1,
    externalProductId: 10,
    productCode: "P1",
    sku: "SKU1",
    productName: "Produto",
    orderedQuantity: 2,
    orderUnitPrice: 500,
    orderItemTotalValue: 1000,
    stockDocumentId: "doc-1",
    stockDocumentExternalId: 99,
    stockDocumentDate: "2026-01-20",
    stockDocumentItemQuantity: 2,
    quantityUsedForOrder: 2,
    allocatedValueByOrderPrice: 1000,
    nfeExternalId: 5,
    nfeNumber: "100",
    nfeHeaderValue: 1000,
    receivableTotalValue: 1000,
    receivableOpenValue: 400,
    receivableReceivedValue: 600,
    orderToCashStage: "CR_ABERTO",
    confidenceLabel: "ALTA",
    alertsJson: [],
    ...partial,
  };
}

describe("orderToCashAuditToPortfolioFactsAdapter", () => {
  it("mapeia estágios O2C para maturidade", () => {
    assert.equal(mapOrderToCashStageToMaturityStatus("RECEBIDO"), "RECEBIDO");
    assert.equal(mapOrderToCashStageToMaturityStatus("NF_SEM_CR"), "FATURADO_SEM_CR");
    assert.equal(
      mapOrderToCashStageToMaturityStatus("PEDIDO_FUTURO_SAUDAVEL"),
      "CARTEIRA_FUTURA_PROVAVEL"
    );
    assert.equal(
      mapOrderToCashStageToMaturityStatus("PEDIDO_PROXIMO_ATENCAO"),
      "CARTEIRA_PRESENTE_ATENCAO"
    );
    assert.equal(
      mapOrderToCashStageToMaturityStatus("BLOQUEADO_REVISAO"),
      "CARTEIRA_VENCIDA_BLOQUEADA"
    );
  });

  it("não duplica CR em múltiplas linhas do mesmo pedido", () => {
    const adapted = adaptOrderToCashAuditFactsToPortfolioFacts([
      o2cFact({ id: "a", salesOrderItemId: "i1", receivableTotalValue: 1000 }),
      o2cFact({
        id: "b",
        salesOrderItemId: "i2",
        receivableTotalValue: 1000,
        receivableOpenValue: 400,
        receivableReceivedValue: 600,
      }),
    ]);
    assert.equal(adapted.length, 2);
    assert.equal(adapted[0]!.receivableTotalValue, 1000);
    assert.equal(adapted[1]!.receivableTotalValue, null);
    assert.equal(adapted[1]!.receivedValue, null);
    assert.equal(adapted[1]!.openReceivableValue, null);
    assert.match(JSON.stringify(adapted[0]!.traceJson), /order_to_cash_audit/);
  });

  it("propaga alertas principais das flags O2C", () => {
    const [row] = adaptOrderToCashAuditFactsToPortfolioFacts([
      o2cFact({
        id: "x",
        hasExcessQuantity: true,
        hasProductOutsideOrder: true,
        hasNfeHeaderGreaterThanOrder: true,
        hasDocumentWithoutReceivable: true,
        hasOverdueReceivable: true,
        hasPriceMismatch: true,
        hasPaymentConditionMissing: true,
        hasMissingStockDocument: true,
      }),
    ]);
    const alerts = row!.alertsJson as string[];
    for (const a of [
      "DOCUMENTO_COM_EXCEDENTE",
      "PRODUTO_FORA_DO_PEDIDO",
      "NF_CABECALHO_MAIOR_PEDIDO",
      "DOCUMENTO_SEM_CR",
      "CR_VENCIDO",
      "DIVERGENCIA_PRECO",
      "SEM_CONDICAO_PAGAMENTO",
      "ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO",
    ]) {
      assert.ok(alerts.includes(a), a);
    }
  });

  it("override de status usa estágio O2C", () => {
    const facts = adaptOrderToCashAuditFactsToPortfolioFacts([
      o2cFact({ id: "1", orderToCashStage: "PEDIDO_FUTURO_SAUDAVEL" }),
    ]);
    const base = {
      salesOrderId: "so-1",
      orderCode: "PD 1",
      externalSalesOrderId: 1,
      customerName: "Britânia",
      customerExternalId: 200,
      customerId: "c1",
      sellerName: null,
      sellerExternalId: null,
      sellerId: null,
      companyId: null,
      issueDate: "2026-01-10",
      expectedDeliveryDate: "2026-02-10",
      nfeDate: null,
      stockDocumentDate: null,
      receivableDueDate: null,
      receivableSettlementDate: null,
      forecastDate: "2026-02-10",
      updatedAt: null,
      orderValue: 1000,
      receivableTotalValue: 0,
      receivedValue: 0,
      openReceivableValue: 0,
      nfeHeaderValue: 0,
      stockDocumentValue: 0,
      itemizedAllocatedValue: 0,
      statusPrincipal: "SEM_EVIDENCIA" as const,
      tagsAlerta: [],
      confidenceScore: 50,
      confidenceLabel: "MEDIA" as const,
      confidenceReasons: [],
      recommendedAction: "—",
      executiveSummary: "—",
      daysSinceIssue: 10,
      daysSinceExpected: null,
      nextRelevantDate: null,
      mainReason: "—",
      evidenceFlags: {
        hasNfe: false,
        hasStockDocument: false,
        hasAllocatedStockDocument: false,
        hasReceivable: false,
        hasReceived: false,
        hasOpenReceivable: false,
      },
      forecastSource: "ORDER",
      factStatus: "ORDER_ONLY",
      productExternalIds: [],
      financialStatus: "FIN_SEM_CR",
      operationalStatus: "OP_NAO_ATENDIDO",
      fulfillmentPercent: 0,
      excessQuantity: 0,
      estimatedExcessValue: 0,
      valueOutsideOrder: 0,
      nfeHeaderNotAttributed: 0,
      fulfillmentAvailable: true,
    } satisfies PortfolioMaturityOrderRow;

    const [out] = applyOrderToCashStageStatusOverrides([base], facts);
    assert.equal(out!.statusPrincipal, "CARTEIRA_FUTURA_PROVAVEL");
  });

  it("disclaimer de cadeia Pedido → CR → Caixa", () => {
    assert.match(ORDER_TO_CASH_AUDIT_CHAIN_DISCLAIMER, /não é caixa confirmado/i);
    assert.match(ORDER_TO_CASH_AUDIT_CHAIN_DISCLAIMER, /CR confirma financeiro/i);
    assert.match(ORDER_TO_CASH_AUDIT_CHAIN_DISCLAIMER, /Baixa confirma caixa/i);
  });
});

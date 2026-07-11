import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOperationalDeviationAlerts,
  type BuildOperationalDeviationAlertsInput,
} from "./portfolioOperationalDeviationAlerts.js";
import type { PortfolioOrderFulfillmentMap } from "./portfolioOrderFulfillmentMap.js";

const AS_OF = "2026-07-10";

function emptyMap(
  partial: Partial<PortfolioOrderFulfillmentMap> = {}
): PortfolioOrderFulfillmentMap {
  return {
    financialStatus: "FIN_SEM_CR",
    financialStatusLabel: "Sem CR",
    operationalStatus: "OP_NAO_ATENDIDO",
    operationalStatusLabel: "Não atendido",
    technicalAlerts: [],
    fulfillmentSummary: {
      orderValue: 10_000,
      attributedOrderValueByOrderPrice: 0,
      attributedOrderValue: 0,
      totalOrderedQuantity: 10,
      totalOrderQuantity: 10,
      totalAttendedQuantityCapped: 0,
      attendedQuantity: 0,
      totalRemainingQuantity: 10,
      remainingQuantity: 10,
      totalExcessQuantity: 0,
      fulfillmentPercent: 0,
      receivableTotalValue: 0,
      receivableTotal: 0,
      receivedValue: 0,
      openReceivableValue: 0,
      nfeHeaderTotalValue: 0,
      nfeHeaderTotal: 0,
      nfeHeaderAttributedToOrderValue: 0,
      nfeHeaderNotAttributedToOrderValue: 0,
      nfeHeaderNotAttributed: 0,
      isFullyFulfilledByItems: false,
      hasExcessQuantity: false,
      hasHeaderInflationRisk: false,
      hasProductsOutsideOrder: false,
    },
    orderItemsCoverage: [],
    stockDocumentsCoverage: [],
    receivablesCoverage: [],
    executiveConclusion: "—",
    evidenceWarnings: [],
    ...partial,
  };
}

function base(
  partial: Partial<BuildOperationalDeviationAlertsInput> = {}
): BuildOperationalDeviationAlertsInput {
  return {
    orderCode: "PD 00001",
    orderValue: 10_000,
    asOfDate: AS_OF,
    expectedDeliveryDate: "2026-09-15",
    forecastDate: "2026-09-15",
    forecastSource: "ORDER",
    hasStockDocument: false,
    hasNfe: false,
    hasReceivable: false,
    receivedValue: 0,
    openReceivableValue: 0,
    ...partial,
  };
}

describe("portfolioOperationalDeviationAlerts", () => {
  it("1) entrega vencida sem documento gera WARNING/CRITICAL", () => {
    const alerts = buildOperationalDeviationAlerts(
      base({
        expectedDeliveryDate: "2026-06-01",
        items: [
          {
            productCode: "618.10AA",
            expectedDate: "2026-06-15",
            remainingQuantity: 5,
          },
        ],
      })
    );
    const a = alerts.find((x) => x.code === "ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO");
    assert.ok(a);
    assert.ok(a!.severity === "WARNING" || a!.severity === "CRITICAL");
    assert.match(a!.message, /618\.10AA|entrega prevista/i);
    assert.match(a!.message, /documento de saída/i);

    const critical = buildOperationalDeviationAlerts(
      base({
        expectedDeliveryDate: "2025-12-01",
        items: [{ productCode: "X", expectedDate: "2025-12-01" }],
      })
    ).find((x) => x.code === "ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO");
    assert.equal(critical?.severity, "CRITICAL");
  });

  it("2) recebimento próximo sem CR gera WARNING", () => {
    const alerts = buildOperationalDeviationAlerts(
      base({
        forecastDate: "2026-07-20",
        expectedDeliveryDate: "2026-07-20",
        hasReceivable: false,
      })
    );
    const a = alerts.find((x) => x.code === "RECEBIMENTO_PREVISTO_PROXIMO_SEM_CR");
    assert.ok(a);
    assert.equal(a!.severity, "WARNING");
    assert.match(a!.message, /Contas a Receber|CR/i);
  });

  it("3) documento parcial gera WARNING", () => {
    const map = emptyMap({
      operationalStatus: "OP_PARCIALMENTE_ATENDIDO",
      fulfillmentSummary: {
        ...emptyMap().fulfillmentSummary,
        totalAttendedQuantityCapped: 4,
        attendedQuantity: 4,
        totalRemainingQuantity: 6,
        remainingQuantity: 6,
        fulfillmentPercent: 40,
      },
      stockDocumentsCoverage: [
        {
          nfeNumber: "100",
          nfeExternalId: 1,
          stockDocumentExternalId: 9,
          date: "2026-07-01",
          nfeHeaderValue: 4000,
          valueAttributedToOrder: 4000,
          valueNotAttributedToOrder: 0,
          matchedItems: [],
          unmatchedItems: [],
          itemsOutsideOrder: [],
          surplusItems: [],
          alerts: [],
        },
      ],
      orderItemsCoverage: [
        {
          salesOrderItemId: "i1",
          externalProductId: 1,
          productExternalId: 1,
          productCode: "A",
          sku: "A",
          description: "Item A",
          orderedQuantity: 10,
          attendedQuantityCapped: 4,
          attendedQuantity: 4,
          remainingQuantity: 6,
          excessQuantityForThisProduct: 0,
          fulfillmentPercentCapped: 40,
          fulfillmentPercent: 40,
          orderUnitValue: 100,
          orderItemValue: 1000,
          attendedValueByOrderPrice: 400,
          documentsUsed: [],
          alerts: [],
        },
      ],
    });
    const alerts = buildOperationalDeviationAlerts(
      base({
        hasStockDocument: true,
        hasNfe: true,
        fulfillmentMap: map,
      })
    );
    const a = alerts.find((x) => x.code === "DOCUMENTO_PARCIAL");
    assert.ok(a);
    assert.equal(a!.severity, "WARNING");
  });

  it("4) excesso gera WARNING", () => {
    const map = emptyMap({
      operationalStatus: "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE",
      technicalAlerts: ["QUANTIDADE_EXCEDENTE_DOCUMENTO"],
      fulfillmentSummary: {
        ...emptyMap().fulfillmentSummary,
        totalExcessQuantity: 3,
        hasExcessQuantity: true,
        isFullyFulfilledByItems: true,
        totalRemainingQuantity: 0,
        remainingQuantity: 0,
      },
    });
    const a = buildOperationalDeviationAlerts(
      base({ hasStockDocument: true, fulfillmentMap: map })
    ).find((x) => x.code === "DOCUMENTO_COM_EXCEDENTE");
    assert.ok(a);
    assert.equal(a!.severity, "WARNING");
  });

  it("5) produto fora gera WARNING", () => {
    const map = emptyMap({
      technicalAlerts: ["PRODUTO_FORA_DO_PEDIDO"],
      fulfillmentSummary: {
        ...emptyMap().fulfillmentSummary,
        hasProductsOutsideOrder: true,
        nfeHeaderNotAttributedToOrderValue: 500,
        nfeHeaderNotAttributed: 500,
      },
      stockDocumentsCoverage: [
        {
          nfeNumber: null,
          nfeExternalId: null,
          stockDocumentExternalId: 1,
          date: null,
          nfeHeaderValue: null,
          valueAttributedToOrder: 0,
          valueNotAttributedToOrder: 500,
          matchedItems: [],
          unmatchedItems: [],
          itemsOutsideOrder: [
            {
              externalProductId: 99,
              productExternalId: 99,
              productCode: "FORA",
              description: "Produto fora",
              documentQuantity: 1,
              documentUnitValue: 500,
              documentValue: 500,
              stockQuantity: 1,
              stockItemValue: 500,
              reason: "NOT_IN_ORDER",
            },
          ],
          surplusItems: [],
          alerts: ["PRODUTO_FORA_DO_PEDIDO"],
        },
      ],
    });
    const a = buildOperationalDeviationAlerts(
      base({ hasStockDocument: true, fulfillmentMap: map })
    ).find((x) => x.code === "DOCUMENTO_COM_PRODUTO_FORA_PEDIDO");
    assert.ok(a);
    assert.equal(a!.severity, "WARNING");
    assert.ok(a!.affectedItems.includes("FORA"));
  });

  it("6) documento sem CR gera WARNING", () => {
    const a = buildOperationalDeviationAlerts(
      base({
        hasNfe: true,
        hasStockDocument: true,
        hasReceivable: false,
        forecastDate: "2026-12-01",
      })
    ).find((x) => x.code === "NF_DOCUMENTO_SEM_CR");
    assert.ok(a);
    assert.equal(a!.severity, "WARNING");
  });

  it("7) CR diferente da previsão gera INFO/WARNING", () => {
    const info = buildOperationalDeviationAlerts(
      base({
        hasReceivable: true,
        openReceivableValue: 8_000,
        receivableDueDate: "2026-08-20",
        forecastDate: "2026-08-10",
        forecastSource: "ORDER",
        expectedDeliveryDate: "2026-08-10",
      })
    ).find((x) => x.code === "CR_DIFERE_DA_CONDICAO_PEDIDO");
    assert.ok(info);
    assert.ok(info!.severity === "INFO" || info!.severity === "WARNING");

    const warn = buildOperationalDeviationAlerts(
      base({
        hasReceivable: true,
        openReceivableValue: 8_000,
        receivableDueDate: "2026-10-01",
        forecastDate: "2026-08-01",
        forecastSource: "ORDER",
      })
    ).find((x) => x.code === "CR_DIFERE_DA_CONDICAO_PEDIDO");
    assert.equal(warn?.severity, "WARNING");
  });

  it("8) não inventa baixa recente sem evidência", () => {
    const without = buildOperationalDeviationAlerts(
      base({
        hasReceivable: true,
        openReceivableValue: 5_000,
        runIsLatest: false,
        dataStaleFlag: true,
        settlementEvidenceAfterRun: false,
      })
    );
    assert.equal(
      without.some((x) => x.code === "BAIXA_RECENTE_NAO_REFLETIDA"),
      false
    );

    const withEvidence = buildOperationalDeviationAlerts(
      base({
        hasReceivable: true,
        openReceivableValue: 5_000,
        settlementEvidenceAfterRun: true,
      })
    );
    assert.ok(
      withEvidence.some((x) => x.code === "BAIXA_RECENTE_NAO_REFLETIDA")
    );
  });
});

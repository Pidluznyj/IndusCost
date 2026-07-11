import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildPortfolioO2cBusinessKpis } from "./portfolioO2cBusinessKpis.js";
import type { PortfolioMaturityOrderRow } from "./portfolioMaturityAnalytics.js";

function row(
  partial: Partial<PortfolioMaturityOrderRow> & {
    orderCode: string;
    orderValue: number;
  }
): PortfolioMaturityOrderRow {
  return {
    salesOrderId: partial.salesOrderId ?? partial.orderCode,
    orderCode: partial.orderCode,
    externalSalesOrderId: null,
    customerName: "Cliente",
    customerExternalId: 1,
    customerId: "c1",
    sellerName: "Vendedor",
    sellerExternalId: 1,
    sellerId: "s1",
    companyId: null,
    issueDate: "2026-01-01",
    expectedDeliveryDate: partial.expectedDeliveryDate ?? "2026-08-01",
    nfeDate: null,
    stockDocumentDate: null,
    receivableDueDate: partial.receivableDueDate ?? null,
    receivableSettlementDate: null,
    forecastDate: partial.forecastDate ?? partial.expectedDeliveryDate ?? "2026-08-01",
    updatedAt: null,
    orderValue: partial.orderValue,
    receivableTotalValue: 0,
    receivedValue: 0,
    openReceivableValue: 0,
    nfeHeaderValue: 0,
    stockDocumentValue: 0,
    itemizedAllocatedValue: 0,
    statusPrincipal: partial.statusPrincipal ?? "CARTEIRA_FUTURA_PROVAVEL",
    tagsAlerta: partial.tagsAlerta ?? [],
    confidenceScore: 50,
    confidenceLabel: "MEDIA",
    confidenceReasons: [],
    recommendedAction: "ok",
    executiveSummary: "ok",
    daysSinceIssue: 10,
    daysSinceExpected: null,
    nextRelevantDate: null,
    mainReason: "ok",
    evidenceFlags: {
      hasNfe: false,
      hasStockDocument: false,
      hasAllocatedStockDocument: false,
      hasReceivable: false,
      hasReceived: false,
      hasOpenReceivable: false,
      ...partial.evidenceFlags,
    },
    forecastSource: "ORDER",
    factStatus: "ORDER_ONLY",
    productExternalIds: [],
    financialStatus: null,
    operationalStatus: null,
    fulfillmentPercent: null,
    excessQuantity: 0,
    estimatedExcessValue: 0,
    valueOutsideOrder: 0,
    nfeHeaderNotAttributed: 0,
    fulfillmentAvailable: false,
    ...partial,
  };
}

describe("portfolioO2cBusinessKpis", () => {
  const asOf = "2026-07-11";

  it("calcula valor em pedidos e entrega futura/vencida", () => {
    const kpis = buildPortfolioO2cBusinessKpis(
      [
        row({
          orderCode: "FUT",
          orderValue: 100,
          expectedDeliveryDate: "2026-09-01",
        }),
        row({
          orderCode: "PAST",
          orderValue: 50,
          expectedDeliveryDate: "2026-06-01",
          statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA",
        }),
      ],
      asOf
    );
    const total = kpis.cards.find((c) => c.key === "VALOR_EM_PEDIDOS")!;
    const fut = kpis.cards.find((c) => c.key === "ENTREGA_FUTURA")!;
    const past = kpis.cards.find((c) => c.key === "ENTREGA_VENCIDA")!;
    assert.equal(total.value, 150);
    assert.equal(fut.value, 100);
    assert.equal(past.value, 50);
  });

  it("separa virou CR, doc/NF e só pedido com/sem condição", () => {
    const kpis = buildPortfolioO2cBusinessKpis(
      [
        row({
          orderCode: "CR",
          orderValue: 80,
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
        row({
          orderCode: "DOC",
          orderValue: 40,
          statusPrincipal: "FATURADO_SEM_CR",
          evidenceFlags: {
            hasNfe: true,
            hasStockDocument: true,
            hasAllocatedStockDocument: true,
            hasReceivable: false,
            hasReceived: false,
            hasOpenReceivable: false,
          },
        }),
        row({
          orderCode: "ONLY-OK",
          orderValue: 30,
          tagsAlerta: [],
        }),
        row({
          orderCode: "ONLY-NO",
          orderValue: 20,
          tagsAlerta: ["SEM_CONDICAO_PAGAMENTO"],
        }),
      ],
      asOf
    );
    assert.equal(kpis.cards.find((c) => c.key === "VIROU_CR")!.value, 80);
    assert.equal(kpis.cards.find((c) => c.key === "COM_DOC_OU_NF")!.value, 120);
    assert.equal(kpis.cards.find((c) => c.key === "SO_PEDIDO")!.value, 50);
    assert.equal(kpis.soPedidoComCondicao.value, 30);
    assert.equal(kpis.soPedidoSemCondicao.value, 20);
  });

  it("funil de evidência não usa comissão", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/finance/portfolioO2cBusinessKpis.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /from\s+["'][^"']*commission/i);
    assert.doesNotMatch(src, /from\s+["'][^"']*comiss/i);
    const kpis = buildPortfolioO2cBusinessKpis(
      [
        row({ orderCode: "A", orderValue: 10 }),
        row({
          orderCode: "B",
          orderValue: 20,
          statusPrincipal: "RECEBIDO",
          evidenceFlags: {
            hasNfe: true,
            hasStockDocument: true,
            hasAllocatedStockDocument: true,
            hasReceivable: true,
            hasReceived: true,
            hasOpenReceivable: false,
          },
        }),
      ],
      asOf
    );
    assert.ok(kpis.evidenceFunnel.some((s) => s.key === "SO_PEDIDO"));
    assert.ok(kpis.agingBuckets.length >= 4);
  });
});

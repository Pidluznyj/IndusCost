import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialDemandIntelligenceFilters,
  buildSalesOrderRawMaterialIntelligencePayload,
} from "./salesOrderRawMaterialIntelligenceService.js";
import {
  agingBandLabel,
  emptyIntelligenceBlock,
  filterIntelligenceView,
} from "./materialDemandIntelligenceUi.js";
import {
  calculateRawMaterialDemandForItem,
  classifyRawMaterialDemandItem,
  DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG,
  RAW_MATERIAL_DEMAND_STATUS_LABELS,
  resolveEstimatedConsumptionWindow,
  resolveInvoicedQuantity,
  resolveOpenQuantity,
  type RawMaterialBomLine,
  type RawMaterialDemandOrderItemInput,
} from "./salesOrderRawMaterialEstimation.js";
import type { MaterialDemandFilters } from "./materialDemandFilters.js";
import type {
  ProductBomExplosionRow,
  SalesOrderIntelligenceSourceOrder,
} from "./salesOrderRawMaterialIntelligenceTypes.js";

const REF = new Date(2026, 5, 17);
const BOM: RawMaterialBomLine[] = [
  { materialCode: "MP-01", materialName: "Aço", unit: "KG", quantityPerUnit: 2 },
];
const EXPLOSION: ProductBomExplosionRow[] = [
  {
    materialId: "mat-1",
    materialCode: "MP-01",
    materialName: "Aço",
    unit: "KG",
    unitKey: "kg",
    unitLabel: "KG",
    quantityPerUnit: 2,
    valuePerUnit: 10,
    unitCost: 5,
  },
];

function baseFilters(): MaterialDemandFilters {
  return {
    startDate: null,
    endDate: null,
    dateBasis: "issueDate",
    status: null,
    statuses: [],
    customerId: null,
    productId: null,
    materialId: null,
    companyIssuer: null,
    unitKey: null,
    mode: "quantity",
    search: "",
    includeOrdersWithoutDeliveryDate: true,
    invoicingScope: "all",
    seller: null,
  };
}

function item(
  partial: Partial<RawMaterialDemandOrderItemInput> &
    Pick<RawMaterialDemandOrderItemInput, "itemId" | "orderId">
): RawMaterialDemandOrderItemInput {
  return {
    orderNumber: partial.orderNumber ?? "PV-001",
    orderStatus: partial.orderStatus ?? "SENT_TO_NOMUS",
    issueDate: partial.issueDate ?? new Date(2026, 5, 10),
    expectedDeliveryDate: partial.expectedDeliveryDate ?? null,
    isCancelled: partial.isCancelled ?? false,
    isItemCancelled: partial.isItemCancelled ?? false,
    productId: partial.productId ?? "prod-1",
    productCode: partial.productCode ?? "SKU-1",
    productName: partial.productName ?? "Produto A",
    quantity: partial.quantity ?? 100,
    invoicedQuantity: partial.invoicedQuantity ?? null,
    netAmount: partial.netAmount ?? 10_000,
    invoicedNetAmount: partial.invoicedNetAmount ?? null,
    hasInvoicing: partial.hasInvoicing ?? false,
    lastInvoiceDate: partial.lastInvoiceDate ?? null,
    ...partial,
  };
}

function order(
  partial: Partial<SalesOrderIntelligenceSourceOrder> & Pick<SalesOrderIntelligenceSourceOrder, "id">
): SalesOrderIntelligenceSourceOrder {
  return {
    orderCode: partial.orderCode ?? "PV-001",
    status: partial.status ?? "SENT_TO_NOMUS",
    issueDate: partial.issueDate ?? new Date(2026, 5, 10),
    expectedDeliveryDate: partial.expectedDeliveryDate ?? null,
    totalNetValue: partial.totalNetValue ?? 10_000,
    responsible: partial.responsible ?? "Vendedor A",
    nomusRawResponse: partial.nomusRawResponse ?? { nfes: [] },
    customerName: partial.customerName ?? "Cliente X",
    items: partial.items ?? [
      {
        id: "item-1",
        productId: "prod-1",
        externalProductId: 100,
        skuSnapshot: "SKU-1",
        productNameSnapshot: "Produto A",
        quantity: 100,
        totalNetValue: 10_000,
        unit: "UN",
      },
    ],
    ...partial,
  };
}

function payload(orders: SalesOrderIntelligenceSourceOrder[], explosions = new Map([["prod-1", EXPLOSION]])) {
  const filters = baseFilters();
  return buildSalesOrderRawMaterialIntelligencePayload({
    orders,
    productExplosions: explosions,
    filters,
    intelligenceFilters: buildMaterialDemandIntelligenceFilters(filters),
    referenceDate: REF,
  });
}

describe("salesOrderRawMaterialIntelligence — validação de cenários de negócio", () => {
  it("1. pedido faturado totalmente — recomendada 0 e excluído", () => {
    const p = payload([
      order({
        id: "o1",
        nomusRawResponse: {
          nfes: [{ dataProcessamento: "10/06/2026" }],
          itensPedido: [{ idProduto: 100, quantidade: 100, quantidadeFaturada: 100 }],
        },
      }),
    ]);
    assert.equal(p.intelligence.summary.recommendedDemandQuantity, 0);
    assert.equal(p.intelligence.summary.excludedFullyInvoicedCount, 1);
    const row = p.intelligence.orders[0];
    assert.ok(row);
    assert.equal(row.estimationStatus, "FULLY_INVOICED");
    assert.equal(row.recommendedIncluded, false);
  });

  it("2. pedido sem NF dentro de 14 dias — recomendada e status Aberto dentro do ciclo", () => {
    const rows = calculateRawMaterialDemandForItem(
      item({ itemId: "i", orderId: "o", issueDate: new Date(2026, 5, 10), quantity: 40, hasInvoicing: false }),
      BOM,
      DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG,
      null,
      REF
    );
    assert.equal(rows[0]!.status, "OPEN_WITHIN_CYCLE");
    assert.equal(rows[0]!.classification.statusLabel, RAW_MATERIAL_DEMAND_STATUS_LABELS.OPEN_WITHIN_CYCLE);
    assert.ok(rows[0]!.recommendedDemand > 0);
  });

  it("3. pedido sem NF acima de 14 dias — revisão, conservador, status atrasado", () => {
    const rows = calculateRawMaterialDemandForItem(
      item({ itemId: "i", orderId: "o", issueDate: new Date(2026, 4, 20), quantity: 30, hasInvoicing: false }),
      BOM,
      DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG,
      null,
      REF
    );
    assert.equal(rows[0]!.recommendedDemand, 0);
    assert.equal(rows[0]!.status, "OPEN_OVERDUE_WITHOUT_INVOICE");
    assert.equal(rows[0]!.classification.statusLabel, "Aberto atrasado sem NF");
    assert.ok(rows[0]!.conservativeDemand > 0);
    assert.equal(rows[0]!.classification.reviewRequired, true);
  });

  it("4. pedido parcial com saldo vivo — só saldo restante", () => {
    const rows = calculateRawMaterialDemandForItem(
      item({
        itemId: "i",
        orderId: "o",
        quantity: 100,
        hasInvoicing: true,
        invoicedQuantity: 60,
        lastInvoiceDate: new Date(2026, 5, 10),
      }),
      BOM,
      DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG,
      null,
      REF
    );
    assert.equal(rows[0]!.classification.openQuantity, 40);
    assert.equal(rows[0]!.recommendedDemand, 80);
    assert.equal(rows[0]!.status, "PARTIALLY_INVOICED_LIVE_BALANCE");
    assert.equal(rows[0]!.classification.statusLabel, "Parcial atendido — saldo vivo");
  });

  it("5. pedido parcial com saldo envelhecido — fora da recomendada e em revisão", () => {
    const cls = classifyRawMaterialDemandItem({
      item: item({
        itemId: "i",
        orderId: "o",
        quantity: 80,
        hasInvoicing: true,
        invoicedQuantity: 30,
        lastInvoiceDate: new Date(2026, 4, 20),
      }),
      referenceDate: REF,
      hasValidBom: true,
    });
    assert.equal(cls.status, "PARTIALLY_INVOICED_STALE_BALANCE");
    assert.equal(cls.statusLabel, "Parcial atendido — saldo envelhecido");
    assert.equal(cls.includeInRecommended, false);
    assert.equal(cls.reviewRequired, true);
  });

  it("6. saldo antigo > 30 dias — potencial não realizado sem distorcer recomendada", () => {
    const p = payload([
      order({
        id: "o-old",
        issueDate: new Date(2026, 3, 1),
        items: [{ id: "item-1", productId: "prod-1", quantity: 50, totalNetValue: 5_000 }],
      }),
    ]);
    assert.equal(p.intelligence.summary.recommendedDemandQuantity, 0);
    assert.ok(p.intelligence.summary.unservedRevenuePotential > 0);
    assert.ok(p.intelligence.unservedBalances.length > 0);
    assert.ok(p.intelligence.unservedBalances[0]!.daysAfterLiveWindow > 30);
  });

  it("7. saldo antigo > 60 dias — faixa muito crítico", () => {
    const days = 75;
    assert.match(agingBandLabel(days), /muito crítico/);
    const p = payload([
      order({
        id: "o-60",
        issueDate: new Date(2026, 3, 1),
        items: [{ id: "item-1", productId: "prod-1", quantity: 20, totalNetValue: 2_000 }],
      }),
    ]);
    const unserved = p.intelligence.unservedBalances[0];
    assert.ok(unserved);
    assert.ok(unserved.daysAfterLiveWindow > 60);
    assert.ok(unserved.daysAfterLiveWindow <= 90);
    assert.equal(unserved.agingBucket, "critical_60_90");
  });

  it("8. saldo antigo > 90 dias — provável perda/revisar", () => {
    assert.match(agingBandLabel(100), /provável perda\/revisar/);
    const p = payload([
      order({
        id: "o-90",
        issueDate: new Date(2026, 0, 1),
        items: [{ id: "item-1", productId: "prod-1", quantity: 10, totalNetValue: 1_000 }],
      }),
    ]);
    const unserved = p.intelligence.unservedBalances[0];
    assert.ok(unserved);
    assert.ok(unserved.daysAfterLiveWindow > 90);
    assert.equal(unserved.agingBucket, "probable_loss_90plus");
  });

  it("9. produto sem BOM — revisão com motivo Sem BOM", () => {
    const p = payload([order({ id: "o-nobom" })], new Map());
    assert.ok(p.intelligence.reviewItems.some((r) => r.reason === "Sem BOM"));
    assert.equal(p.intelligence.summary.recommendedDemandQuantity, 0);
    assert.ok(Number.isFinite(p.intelligence.summary.conservativeDemandQuantity));
  });

  it("10. quantidade faturada maior que vendida — saldo não negativo e revisão/warning", () => {
    const open = resolveOpenQuantity(
      item({
        itemId: "i",
        orderId: "o",
        quantity: 100,
        hasInvoicing: true,
        invoicedQuantity: 150,
      })
    );
    assert.equal(open.quantity, 0);
    assert.ok(open.warnings.some((w) => w.includes("maior que vendida")));

    const cls = classifyRawMaterialDemandItem({
      item: item({
        itemId: "i",
        orderId: "o",
        quantity: 100,
        hasInvoicing: true,
        invoicedQuantity: 150,
        lastInvoiceDate: new Date(2026, 5, 10),
      }),
      referenceDate: REF,
      hasValidBom: true,
    });
    assert.equal(cls.reviewRequired, true);
    assert.equal(cls.openQuantity, 0);
  });

  it("11. fallback por valor — baixa confiança e warning", () => {
    const inv = resolveInvoicedQuantity(
      item({
        itemId: "i",
        orderId: "o",
        quantity: 100,
        netAmount: 10_000,
        invoicedNetAmount: 4_000,
        hasInvoicing: true,
        invoicedQuantity: null,
        lastInvoiceDate: new Date(2026, 5, 10),
      })
    );
    assert.equal(inv.usedValueFallback, true);
    assert.equal(inv.confidence, "LOW");
    assert.ok(inv.warnings.length > 0);

    const p = payload([
      order({
        id: "o-fb",
        issueDate: new Date(2026, 5, 10),
        nomusRawResponse: {
          nfes: [{ dataProcessamento: "12/06/2026", valor: 4000 }],
          itensPedido: [{ idProduto: 100, quantidade: 100 }],
        },
      }),
    ]);
    assert.equal(p.intelligence.summary.confidence, "LOW");
  });

  it("12. filtro de período — janela estimada, entrega como hint", () => {
    const orderItem = item({
      itemId: "i",
      orderId: "o",
      issueDate: new Date(2026, 5, 10),
      expectedDeliveryDate: new Date(2026, 8, 1),
      quantity: 100,
      hasInvoicing: false,
    });
    const window = resolveEstimatedConsumptionWindow(orderItem);
    assert.equal(window.basis, "issue_date");
    assert.ok(window.logisticsHintDate);

    const full = calculateRawMaterialDemandForItem(orderItem, BOM, DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG, null, REF);
    const partial = calculateRawMaterialDemandForItem(orderItem, BOM, DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG, {
      start: new Date(2026, 5, 10),
      end: new Date(2026, 5, 12),
    }, REF);
    assert.ok(partial[0]!.recommendedDemand < full[0]!.recommendedDemand);
  });

  it("13. payload vazio — cards zerados e empty state seguro", () => {
    const p = payload([]);
    assert.equal(p.intelligence.summary.recommendedDemandQuantity, 0);
    assert.equal(p.intelligence.materials.length, 0);
    const empty = emptyIntelligenceBlock();
    const filtered = filterIntelligenceView(empty, {
      calculationMode: "recommended",
      estimationStatus: "ALL",
      criticalOnly: false,
      reviewOnly: false,
    });
    assert.deepEqual(filtered.materials, []);
    for (const n of [
      p.intelligence.summary.recommendedDemandValue,
      p.intelligence.summary.conservativeDemandValue,
      p.summary.plannedQuantityTotal,
    ]) {
      assert.ok(Number.isFinite(n));
    }
  });

  it("14. erro por item — revisão sem derrubar payload", () => {
    const p = payload([
      order({
        id: "o-bad",
        issueDate: new Date("invalid") as unknown as Date,
      }),
    ]);
    assert.ok(Array.isArray(p.rows));
    assert.ok(p.intelligence.reviewItems.length > 0);
    assert.ok(Number.isFinite(p.intelligence.summary.recommendedDemandQuantity));
  });
});

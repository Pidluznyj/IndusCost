import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildMaterialDemandIntelligenceFilters,
  buildSalesOrderRawMaterialIntelligencePayload,
  RAW_MATERIAL_INTELLIGENCE_RULES_VERSION,
} from "./salesOrderRawMaterialIntelligenceService.js";
import type { MaterialDemandFilters } from "./materialDemandFilters.js";
import type {
  ProductBomExplosionRow,
  SalesOrderIntelligenceSourceOrder,
} from "./salesOrderRawMaterialIntelligenceTypes.js";

const REF = new Date(2026, 5, 17);

const BOM: ProductBomExplosionRow[] = [
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

function baseFilters(overrides: Partial<MaterialDemandFilters> = {}): MaterialDemandFilters {
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
    ...overrides,
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

function buildPayload(
  orders: SalesOrderIntelligenceSourceOrder[],
  explosions: Map<string, ProductBomExplosionRow[]> = new Map([["prod-1", BOM]])
) {
  const filters = baseFilters();
  return buildSalesOrderRawMaterialIntelligencePayload({
    orders,
    productExplosions: explosions,
    filters,
    intelligenceFilters: buildMaterialDemandIntelligenceFilters(filters),
    referenceDate: REF,
  });
}

describe("salesOrderRawMaterialIntelligenceService", () => {
  it("retorna payload novo com bloco intelligence", () => {
    const payload = buildPayload([order({ id: "o1" })]);
    assert.ok(payload.intelligence);
    assert.ok(payload.intelligence.summary);
    assert.ok(Array.isArray(payload.intelligence.materials));
    assert.ok(Array.isArray(payload.intelligence.orders));
    assert.ok(Array.isArray(payload.intelligence.unservedBalances));
    assert.ok(Array.isArray(payload.intelligence.reviewItems));
    assert.equal(payload.intelligence.audit.rulesVersion, RAW_MATERIAL_INTELLIGENCE_RULES_VERSION);
  });

  it("mantém contrato mínimo antigo (summary, rows, dataQuality)", () => {
    const payload = buildPayload([order({ id: "o1" })]);
    assert.ok(payload.summary);
    assert.ok(Array.isArray(payload.rows));
    assert.ok(payload.dataQuality);
    assert.equal(typeof payload.summary.plannedQuantityTotal, "number");
    assert.equal(typeof payload.summary.realizedQuantityTotal, "number");
    assert.ok(Number.isFinite(payload.summary.plannedCostTotal));
  });

  it("pedido faturado totalmente não entra recomendado", () => {
    const payload = buildPayload([
      order({
        id: "o-full",
        nomusRawResponse: {
          nfes: [{ dataProcessamento: "10/06/2026" }],
          itensPedido: [{ idProduto: 100, quantidade: 100, quantidadeFaturada: 100 }],
        },
        items: [
          {
            id: "item-1",
            productId: "prod-1",
            externalProductId: 100,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "Produto A",
            quantity: 100,
            totalNetValue: 10_000,
          },
        ],
      }),
    ]);
    assert.equal(payload.intelligence.summary.recommendedDemandQuantity, 0);
    assert.equal(payload.intelligence.summary.excludedFullyInvoicedCount, 1);
  });

  it("parcial vivo entra pelo saldo", () => {
    const payload = buildPayload([
      order({
        id: "o-partial-live",
        issueDate: new Date(2026, 5, 10),
        nomusRawResponse: {
          nfes: [{ dataProcessamento: "12/06/2026" }],
          itensPedido: [{ idProduto: 100, quantidade: 100, quantidadeFaturada: 60 }],
        },
        items: [
          {
            id: "item-1",
            productId: "prod-1",
            externalProductId: 100,
            quantity: 100,
            totalNetValue: 10_000,
          },
        ],
      }),
    ]);
    assert.equal(payload.intelligence.summary.recommendedDemandQuantity, 80);
    const row = payload.intelligence.orders[0]!;
    assert.equal(row.openQuantity, 40);
    assert.equal(row.estimationStatus, "PARTIALLY_INVOICED_LIVE_BALANCE");
  });

  it("parcial envelhecido sai do recomendado", () => {
    const payload = buildPayload([
      order({
        id: "o-partial-stale",
        nomusRawResponse: {
          nfes: [{ dataProcessamento: "01/05/2026" }],
          itensPedido: [{ idProduto: 100, quantidade: 100, quantidadeFaturada: 60 }],
        },
        items: [
          {
            id: "item-1",
            productId: "prod-1",
            externalProductId: 100,
            quantity: 100,
            totalNetValue: 10_000,
          },
        ],
      }),
    ]);
    assert.equal(payload.intelligence.summary.recommendedDemandQuantity, 0);
    assert.ok(payload.intelligence.summary.conservativeDemandQuantity > 0);
    assert.equal(payload.intelligence.orders[0]!.recommendedIncluded, false);
  });

  it(">30 dias entra potencial não realizado", () => {
    const payload = buildPayload([
      order({
        id: "o-critical",
        issueDate: new Date(2026, 3, 1),
        items: [
          {
            id: "item-1",
            productId: "prod-1",
            quantity: 50,
            totalNetValue: 5_000,
          },
        ],
      }),
    ]);
    assert.ok(payload.intelligence.summary.unservedRevenuePotential > 0);
    assert.ok(payload.intelligence.unservedBalances.length > 0);
  });

  it("sem BOM entra review", () => {
    const payload = buildPayload([order({ id: "o-nobom" })], new Map());
    assert.ok(payload.intelligence.reviewItems.length > 0);
    assert.ok(payload.intelligence.summary.missingBomCount > 0);
    assert.equal(payload.intelligence.summary.recommendedDemandQuantity, 0);
  });

  it("fallback por valor sinaliza baixa confiança", () => {
    const payload = buildPayload([
      order({
        id: "o-value-fallback",
        issueDate: new Date(2026, 5, 10),
        totalNetValue: 10_000,
        nomusRawResponse: {
          nfes: [{ dataProcessamento: "12/06/2026", valor: 4000 }],
          itensPedido: [{ idProduto: 100, quantidade: 100 }],
        },
        items: [
          {
            id: "item-1",
            productId: "prod-1",
            externalProductId: 100,
            quantity: 100,
            totalNetValue: 10_000,
          },
        ],
      }),
    ]);
    assert.equal(payload.intelligence.summary.confidence, "LOW");
  });

  it("sem dados não gera NaN", () => {
    const payload = buildPayload([
      order({
        id: "o-nan",
        totalNetValue: NaN,
        items: [
          {
            id: "item-1",
            productId: "prod-1",
            quantity: NaN,
            totalNetValue: Infinity,
          },
        ],
      }),
    ]);
    const nums = [
      payload.intelligence.summary.recommendedDemandQuantity,
      payload.intelligence.summary.conservativeDemandQuantity,
      payload.summary.plannedQuantityTotal,
      payload.summary.realizedQuantityTotal,
    ];
    for (const n of nums) assert.ok(Number.isFinite(n));
  });

  it("item com dados inválidos vai para revisão sem derrubar payload", () => {
    const payload = buildPayload([
      order({
        id: "o-bad-date",
        issueDate: new Date("invalid-date") as unknown as Date,
      }),
    ]);
    assert.ok(Array.isArray(payload.rows));
    assert.ok(payload.intelligence.reviewItems.length > 0);
  });
});

describe("salesOrderRawMaterialIntelligence endpoint contract", () => {
  it("handler planned-vs-realized expõe intelligence sem remover campos antigos", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const handler = server.slice(
      server.indexOf("handleMaterialDemandPlannedVsRealized ="),
      server.indexOf("handleMaterialDemandPlannedVsRealizedDetails")
    );
    assert.match(handler, /summary: data\.summary/);
    assert.match(handler, /rows: data\.rows/);
    assert.match(handler, /dataQuality: data\.dataQuality/);
    assert.match(handler, /intelligence: data\.intelligence/);
    assert.match(server, /buildMaterialDemandPlannedVsRealizedDataset/);
    assert.match(server, /buildSalesOrderRawMaterialIntelligencePayload/);
  });
});

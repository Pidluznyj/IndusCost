import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCustomerIntelligenceProducts } from "./customerIntelligenceProducts.js";
import {
  CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_DAYS,
  CUSTOMER_INTELLIGENCE_NEW_PRODUCT_DAYS,
} from "./customerIntelligenceUtils.js";
import type { CustomerIntelligenceOrderInput } from "./customerIntelligenceTypes.js";

const NOW = new Date("2026-06-17T12:00:00.000Z");

function order(
  overrides: Partial<CustomerIntelligenceOrderInput> & Pick<CustomerIntelligenceOrderInput, "id">
): CustomerIntelligenceOrderInput {
  return {
    orderCode: overrides.orderCode ?? "PV-100",
    status: overrides.status ?? "SENT_TO_NOMUS",
    issueDate: overrides.issueDate ?? new Date("2025-03-15T12:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2025-03-16T12:00:00.000Z"),
    responsible: overrides.responsible ?? "Carlos",
    totalNetValue: overrides.totalNetValue ?? 5000,
    totalMarginValue: overrides.totalMarginValue ?? 500,
    totalMarginPerc: overrides.totalMarginPerc ?? 10,
    hasInvoicing: overrides.hasInvoicing ?? true,
    items: overrides.items ?? [
      {
        productId: "p1",
        quantity: 2,
        totalNetValue: 5000,
        marginValue: 500,
        marginPerc: 10,
        Product: { id: "p1", sku: "SKU-A", name: "Produto A", type: "FINAL" },
      },
    ],
    ...overrides,
  };
}

describe("buildCustomerIntelligenceProducts", () => {
  it("agrupa itens por produto", () => {
    const { products } = buildCustomerIntelligenceProducts(
      [
        order({
          id: "o1",
          items: [
            {
              productId: "p1",
              quantity: 2,
              totalNetValue: 3000,
              marginValue: 300,
              marginPerc: 10,
              Product: { id: "p1", sku: "A", name: "Prod A", type: "FINAL" },
            },
            {
              productId: "p1",
              quantity: 1,
              totalNetValue: 2000,
              marginValue: 200,
              marginPerc: 10,
              Product: { id: "p1", sku: "A", name: "Prod A", type: "FINAL" },
            },
          ],
        }),
      ],
      10,
      NOW
    );

    assert.equal(products.topByRevenue.length, 1);
    assert.equal(products.topByRevenue[0]!.quantity, 3);
    assert.equal(products.topByRevenue[0]!.revenue, 5000);
    assert.equal(products.topByRevenue[0]!.productCode, "A");
  });

  it("ordena top receita e top quantidade", () => {
    const { products } = buildCustomerIntelligenceProducts(
      [
        order({
          id: "o1",
          items: [
            {
              productId: "p-high",
              quantity: 1,
              totalNetValue: 8000,
              marginValue: 800,
              marginPerc: 10,
              Product: { id: "p-high", sku: "H", name: "Alto", type: "FINAL" },
            },
            {
              productId: "p-qty",
              quantity: 50,
              totalNetValue: 500,
              marginValue: 50,
              marginPerc: 10,
              Product: { id: "p-qty", sku: "Q", name: "Qty", type: "FINAL" },
            },
          ],
        }),
      ],
      10,
      NOW
    );

    assert.equal(products.topByRevenue[0]!.productId, "p-high");
    assert.equal(products.topByQuantity[0]!.productId, "p-qty");
  });

  it("calcula participação no cliente e concentração top 3", () => {
    const { products } = buildCustomerIntelligenceProducts(
      [
        order({
          id: "o1",
          items: [
            {
              productId: "p1",
              quantity: 1,
              totalNetValue: 7500,
              marginValue: 750,
              marginPerc: 10,
              Product: { id: "p1", sku: "P1", name: "Um", type: "FINAL" },
            },
            {
              productId: "p2",
              quantity: 1,
              totalNetValue: 2500,
              marginValue: 250,
              marginPerc: 10,
              Product: { id: "p2", sku: "P2", name: "Dois", type: "FINAL" },
            },
          ],
        }),
      ],
      10,
      NOW
    );

    assert.equal(products.topByRevenue[0]!.shareOfCustomerRevenue, 75);
    assert.equal(products.concentration.top3RevenueSharePercent, 100);
    assert.equal(products.concentration.distinctProductsCount, 2);
  });

  it("identifica produto abandonado", () => {
    const oldDate = new Date(NOW);
    oldDate.setDate(oldDate.getDate() - CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_DAYS - 30);

    const { products } = buildCustomerIntelligenceProducts(
      [
        order({
          id: "old",
          issueDate: oldDate,
          items: [
            {
              productId: "p-old",
              quantity: 5,
              totalNetValue: 4000,
              marginValue: 400,
              marginPerc: 10,
              Product: { id: "p-old", sku: "OLD", name: "Antigo", type: "FINAL" },
            },
          ],
        }),
        order({
          id: "recent",
          issueDate: new Date("2026-05-01T12:00:00.000Z"),
          items: [
            {
              productId: "p-new",
              quantity: 1,
              totalNetValue: 1000,
              marginValue: 100,
              marginPerc: 10,
              Product: { id: "p-new", sku: "NEW", name: "Recente", type: "FINAL" },
            },
          ],
        }),
      ],
      10,
      NOW
    );

    assert.equal(products.abandonedProducts.length, 1);
    assert.equal(products.abandonedProducts[0]!.productId, "p-old");
    assert.ok((products.abandonedProducts[0]!.daysSinceLastPurchase ?? 0) > CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_DAYS);
  });

  it("identifica produto recorrente", () => {
    const { products } = buildCustomerIntelligenceProducts(
      [
        order({
          id: "o1",
          issueDate: new Date("2025-01-10T12:00:00.000Z"),
          items: [
            {
              productId: "p-rec",
              quantity: 1,
              totalNetValue: 1000,
              marginValue: 100,
              marginPerc: 10,
              Product: { id: "p-rec", sku: "R", name: "Recorrente", type: "FINAL" },
            },
          ],
        }),
        order({
          id: "o2",
          issueDate: new Date("2025-08-10T12:00:00.000Z"),
          items: [
            {
              productId: "p-rec",
              quantity: 2,
              totalNetValue: 2000,
              marginValue: 200,
              marginPerc: 10,
              Product: { id: "p-rec", sku: "R", name: "Recorrente", type: "FINAL" },
            },
          ],
        }),
      ],
      10,
      NOW
    );

    assert.equal(products.recurringProducts.length, 1);
    assert.equal(products.recurringProducts[0]!.ordersCount, 2);
  });

  it("identifica produto novo no mix", () => {
    const recent = new Date(NOW);
    recent.setDate(recent.getDate() - Math.floor(CUSTOMER_INTELLIGENCE_NEW_PRODUCT_DAYS / 2));

    const { products } = buildCustomerIntelligenceProducts(
      [
        order({
          id: "o-new",
          issueDate: recent,
          items: [
            {
              productId: "p-new",
              quantity: 1,
              totalNetValue: 1500,
              marginValue: 150,
              marginPerc: 10,
              Product: { id: "p-new", sku: "N", name: "Novo", type: "FINAL" },
            },
          ],
        }),
      ],
      10,
      NOW
    );

    assert.equal(products.newProducts.length, 1);
    assert.equal(products.newProducts[0]!.productId, "p-new");
  });

  it("cliente sem produtos não gera NaN", () => {
    const { products, warnings } = buildCustomerIntelligenceProducts([], 10, NOW);

    assert.deepEqual(products.topByRevenue, []);
    assert.equal(products.concentration.distinctProductsCount, 0);
    assert.equal(products.concentration.top3RevenueSharePercent, null);
    assert.deepEqual(products.productOpportunities, []);
    assert.equal(warnings.length, 0);
  });

  it("gera oportunidades por produto", () => {
    const oldDate = new Date(NOW);
    oldDate.setDate(oldDate.getDate() - CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_DAYS - 10);

    const { products } = buildCustomerIntelligenceProducts(
      [
        order({
          id: "o1",
          issueDate: oldDate,
          items: [
            {
              productId: "p1",
              quantity: 10,
              totalNetValue: 9000,
              marginValue: 900,
              marginPerc: 10,
              Product: { id: "p1", sku: "P1", name: "Líder", type: "FINAL" },
            },
          ],
        }),
        order({
          id: "o2",
          issueDate: new Date("2026-01-15T12:00:00.000Z"),
          items: [
            {
              productId: "p2",
              quantity: 1,
              totalNetValue: 500,
              marginValue: 100,
              marginPerc: 20,
              Product: { id: "p2", sku: "P2", name: "Margem", type: "FINAL" },
            },
          ],
        }),
      ],
      10,
      NOW
    );

    assert.ok(products.productOpportunities.some((o) => o.kind === "offer_again"));
    assert.ok(products.productOpportunities.some((o) => o.kind === "low_mix"));
  });

  it("topByMargin ordena por margem acumulada", () => {
    const { products } = buildCustomerIntelligenceProducts(
      [
        order({
          id: "o1",
          items: [
            {
              productId: "p-low",
              quantity: 1,
              totalNetValue: 5000,
              marginValue: 200,
              marginPerc: 4,
              Product: { id: "p-low", sku: "L", name: "Baixa margem", type: "FINAL" },
            },
            {
              productId: "p-high",
              quantity: 1,
              totalNetValue: 3000,
              marginValue: 900,
              marginPerc: 30,
              Product: { id: "p-high", sku: "H", name: "Alta margem", type: "FINAL" },
            },
          ],
        }),
      ],
      10,
      NOW
    );

    assert.equal(products.topByMargin[0]!.productId, "p-high");
    assert.equal(products.topByMargin[0]!.marginAmount, 900);
  });
});

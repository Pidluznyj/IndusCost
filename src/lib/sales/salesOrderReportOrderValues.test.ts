import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAmountToInvoice } from "./orderFiscalFinancialMetrics.js";
import { resolveSalesOrderReportOrderValues } from "./salesOrderReportOrderValues.js";

describe("resolveSalesOrderReportOrderValues", () => {
  it("PD 02541-like: desconto comercial não vira A faturar", () => {
    // Bruto itens 39.600; líquido oficial 37.620; desconto 1.980; NF 37.620.
    const values = resolveSalesOrderReportOrderValues({
      officialOrderNetValue: 37620,
      orderStatus: "SENT_TO_NOMUS",
      rawItems: [
        {
          quantityOrdered: 100,
          unitPrice: 396,
          statusNormalized: "OPEN",
        },
      ],
    });

    assert.equal(values.originalValue, 37620);
    assert.equal(values.activeValue, 37620);
    assert.equal(values.grossActiveValue, 39600);
    assert.equal(values.discountValue, 1980);
    assert.equal(computeAmountToInvoice(values.activeValue, 37620), 0);
  });

  it("preserva líquido oficial quando linhas ≈ net (±2%)", () => {
    const values = resolveSalesOrderReportOrderValues({
      officialOrderNetValue: 1000,
      orderStatus: "SENT_TO_NOMUS",
      rawItems: [
        {
          quantityOrdered: 10,
          unitPrice: 100.1,
          statusNormalized: "OPEN",
        },
      ],
    });
    assert.equal(values.originalValue, 1000);
    assert.equal(values.activeValue, 1000);
    assert.equal(values.discountValue, 0);
  });

  it("escala cancelamento quando linhas estão em base bruta", () => {
    const values = resolveSalesOrderReportOrderValues({
      officialOrderNetValue: 900,
      orderStatus: "SENT_TO_NOMUS",
      rawItems: [
        {
          quantityOrdered: 10,
          unitPrice: 100,
          statusNormalized: "OPEN",
        },
        {
          quantityOrdered: 1,
          unitPrice: 100,
          statusNormalized: "CANCELED",
        },
      ],
    });
    // Bruto 1100 → líquido oficial 900; cancelado bruto 100 → escala 900/1100.
    assert.equal(values.originalValue, 900);
    assert.equal(values.canceledValue, 81.82);
    assert.equal(values.activeValue, 818.18);
    assert.equal(values.discountValue, 181.82);
    assert.equal(values.canceledItemsCount, 1);
    assert.equal(values.activeItemsCount, 1);
  });

  it("descarta linhas em escala corrompida e mantém totalNetValue", () => {
    const values = resolveSalesOrderReportOrderValues({
      officialOrderNetValue: 5000,
      orderStatus: "SENT_TO_NOMUS",
      rawItems: [
        {
          quantityOrdered: 10,
          unitPrice: 1,
          statusNormalized: "OPEN",
        },
      ],
    });
    assert.equal(values.originalValue, 5000);
    assert.equal(values.activeValue, 5000);
    assert.equal(values.discountValue, 0);
    assert.equal(values.canceledValue, 0);
  });

  it("pedido cancelado sem itens raw zera ativo", () => {
    const values = resolveSalesOrderReportOrderValues({
      officialOrderNetValue: 250,
      orderStatus: "CANCELLED",
      itemsCountFallback: 3,
      rawItems: [],
    });
    assert.equal(values.originalValue, 250);
    assert.equal(values.canceledValue, 250);
    assert.equal(values.activeValue, 0);
    assert.equal(values.canceledItemsCount, 3);
  });
});

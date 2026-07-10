import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAggregatedForecastLabel,
  computeOrderProjectedOpenBalance,
  computeProjectedOpenBalance,
  resolveOrderAggregatedForecast,
} from "./portfolioReconciliationProjectedBalance.js";

describe("portfolioReconciliationProjectedBalance", () => {
  it("RECEIVABLE não soma rollup FULLY_ALLOCATED/NFE", () => {
    const balance = computeOrderProjectedOpenBalance([
      {
        id: "a",
        salesOrderId: "o1",
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        forecastValue: 17550,
        openReceivableValue: 17550,
        allocatedQuantity: 3000,
      },
      {
        id: "b",
        salesOrderId: "o1",
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        forecastValue: 140450,
        openReceivableValue: 140450,
        allocatedQuantity: 24000,
      },
      {
        id: "rollup",
        salesOrderId: "o1",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastValue: 158000,
        openReceivableValue: null,
        allocatedQuantity: null,
      },
    ]);
    assert.equal(balance, 158000);
  });

  it("PD 02339: forecast agregado RECEIVABLE ignora 20/05 do FULLY_ALLOCATED", () => {
    const facts = [
      {
        id: "a",
        salesOrderId: "o1",
        orderCode: "PD 02339",
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        forecastDate: "2026-07-10",
        forecastValue: 17550,
        openReceivableValue: 17550,
        allocatedQuantity: 3000,
        dueDatesJson: ["2026-07-10"],
      },
      {
        id: "b",
        salesOrderId: "o1",
        orderCode: "PD 02339",
        status: "RECEIVABLE_CONFIRMED",
        forecastSource: "RECEIVABLE",
        forecastDate: "2026-08-10",
        forecastValue: 140450,
        openReceivableValue: 140450,
        allocatedQuantity: 24000,
        dueDatesJson: ["2026-08-10"],
      },
      {
        id: "rollup",
        salesOrderId: "o1",
        orderCode: "PD 02339",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastDate: "2026-05-20",
        forecastValue: 158000,
        openReceivableValue: null,
        allocatedQuantity: null,
      },
    ];

    assert.equal(computeOrderProjectedOpenBalance(facts), 158000);
    const forecast = resolveOrderAggregatedForecast(facts);
    assert.equal(forecast.source, "RECEIVABLE");
    assert.equal(forecast.primaryDate, "2026-07-10");
    assert.notEqual(forecast.primaryDate, "2026-05-20");
    assert.deepEqual(forecast.dates, ["2026-07-10", "2026-08-10"]);
    assert.equal(forecast.dueCount, 2);
    assert.equal(forecast.label, "10/07/2026 + 1 vencimento");
    assert.equal(buildAggregatedForecastLabel(["2026-07-10"]), "10/07/2026");
  });

  it("UNRESOLVED e surplus não entram no saldo", () => {
    const balance = computeOrderProjectedOpenBalance([
      {
        id: "s",
        salesOrderId: "o1",
        status: "QUANTITY_SURPLUS_IN_NFE",
        forecastSource: "UNRESOLVED",
        forecastValue: null,
        openReceivableValue: null,
        allocatedQuantity: 0,
      },
      {
        id: "o",
        salesOrderId: "o1",
        status: "OVER_LINKED_BY_HEADER",
        forecastSource: "UNRESOLVED",
        forecastValue: null,
        openReceivableValue: null,
        allocatedQuantity: null,
      },
    ]);
    assert.equal(balance, 0);
  });

  it("NFE usa itens alocados e ignora rollup duplicado", () => {
    const balance = computeProjectedOpenBalance([
      {
        id: "1",
        salesOrderId: "o1",
        status: "ITEM_ALLOCATED",
        forecastSource: "NFE",
        forecastValue: 100000,
        openReceivableValue: null,
        allocatedQuantity: 1,
      },
      {
        id: "2",
        salesOrderId: "o1",
        status: "PRICE_MISMATCH",
        forecastSource: "NFE",
        forecastValue: 58000,
        openReceivableValue: null,
        allocatedQuantity: 1,
      },
      {
        id: "3",
        salesOrderId: "o1",
        status: "FULLY_ALLOCATED",
        forecastSource: "NFE",
        forecastValue: 158000,
        openReceivableValue: null,
        allocatedQuantity: null,
      },
    ]);
    assert.equal(balance, 158000);
  });
});

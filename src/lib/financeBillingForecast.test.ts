import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  billingForecastMetricsAreFinite,
  buildBillingForecastMonthlyComparison,
  type BillingForecastBlock,
} from "./financeBillingForecast.js";
import {
  createEmptyFinanceHorizonSummary,
  FINANCE_HORIZON_BILLING_SCOPE_NOTE,
} from "./financeHorizonAggregation.js";
import type { ExecutiveDashboardYearContext } from "./executiveDashboardYear.js";

const REF = new Date(2026, 5, 9);

function yearCtx(): ExecutiveDashboardYearContext {
  return {
    selectedYear: 2026,
    previousYear: 2025,
    referenceDate: REF,
    ytdMonthLimit: 6,
    isSelectedYearCurrent: true,
  };
}

describe("financeBillingForecast", () => {
  it("previsto agrupa por expectedDeliveryDate no mês", () => {
    const realized = new Map<number, number>([[6, 1000]]);
    const raw = [
      {
        id: "1",
        order_code: "P-1",
        customer_name: "Cliente",
        expected_delivery_date: new Date(2026, 5, 15),
        total_net_value: 500,
        status: "OPEN",
        has_nfe: false,
      },
    ];
    const points = buildBillingForecastMonthlyComparison(yearCtx(), realized, raw);
    const jun = points.find((p) => p.month === 6);
    assert.ok(jun);
    assert.equal(jun!.realized, 1000);
    assert.equal(jun!.forecast, 500);
    assert.equal(jun!.difference, 500);
  });

  it("meses futuros no realizado são null", () => {
    const points = buildBillingForecastMonthlyComparison(yearCtx(), new Map([[6, 100]]), []);
    const jul = points.find((p) => p.month === 7);
    assert.ok(jul);
    assert.equal(jul!.realized, null);
  });

  it("métricas finitas no bloco mínimo", () => {
    const block: BillingForecastBlock = {
      dateField: "expectedDeliveryDate",
      portfolioAmount: 100,
      monthForecastAmount: 50,
      overdueAmount: 20,
      overdueCount: 1,
      ordersWithoutDateCount: 0,
      note: "test",
      formatted: {
        portfolioAmount: "R$ 100,00",
        monthForecastAmount: "R$ 50,00",
        overdueAmount: "R$ 20,00",
        overdueCount: "1",
      },
      monthlyComparison: [
        { month: 6, monthLabel: "Jun", realized: 100, forecast: 50, difference: 50 },
      ],
      dailySeries: [{ date: "2026-06-01", label: "01/06", realized: 10, forecast: 5, difference: 5 }],
      orders: [
        {
          orderId: "1",
          orderCode: "P-1",
          customerName: "C",
          expectedDeliveryDate: REF.toISOString(),
          totalNetValue: 50,
          status: "OPEN",
          daysOverdue: 0,
          hasLinkedNfe: false,
        },
      ],
      financialHorizon: createEmptyFinanceHorizonSummary({
        title: "Horizonte de faturamento — próximos 60 dias",
        subtitle: "Previsão por carteira de pedidos ainda não faturados. Não representa NF-e já emitida.",
        scopeNote: FINANCE_HORIZON_BILLING_SCOPE_NOTE,
        countUnitLabel: "pedido(s)",
        ignoresPeriodFilter: true,
      }),
    };
    assert.equal(billingForecastMetricsAreFinite(block), true);
  });
});

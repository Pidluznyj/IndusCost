/**
 * Paridade OP-08 × FIN-08 — agrupamento mensal sem alterar a agenda.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderEffectiveFinancialSchedule } from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";
import { buildFinanceArEffectiveTitles } from "@/src/lib/finance/financeAccountsReceivableEffectiveTitles.js";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  buildMonthColumns,
  computeMonthlyReceivablesTotalsFromRows,
  currentYearMonthKey,
  defaultDueMonthRange,
  defaultMonthlyReceivablesYearFilters,
  formatYearMonthKey,
  scrollLeftToAlignMonthAfterSticky,
  yearMonthKeyFromDueIso,
} from "./salesOrderMonthlyReceivablesReport.js";
import {
  buildMonthlyReceivablesRowFromLines,
  listEffectiveReceivableLinesFromSchedule,
} from "./salesOrderMonthlyReceivablesReportMath.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);

function nomusFromScheduleCr(
  schedule: ReturnType<typeof buildSalesOrderEffectiveFinancialSchedule>
): FinanceArDashboardRow[] {
  return schedule.realReceivables.map((cr) => ({
    externalId: cr.externalId,
    companyName: "Empresa",
    personId: 1,
    personName: "Cliente",
    personCnpj: null,
    description: `CR ${cr.externalId}`,
    comments: null,
    dueDate: cr.dueDate ? new Date(cr.dueDate + "T12:00:00") : null,
    competenceDate: null,
    settlementDate: null,
    amountReceivable: Number(cr.amountReceivable),
    amountReceived: Number(cr.amountReceived),
    balanceReceivable: Number(cr.balanceReceivable),
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: cr.sourceInvoiceId,
    sourceInvoiceNumber: cr.sourceInvoiceId != null ? String(cr.sourceInvoiceId) : null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: REF,
  }));
}

describe("salesOrderMonthlyReceivablesReport — paridade FIN-08", () => {
  it("pedido sem CR: três previsões nos meses de vencimento", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-1",
      orderCode: "PD 09000",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "30000.00" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "30000.00" },
        { installmentNumber: 3, dueDate: "2026-10-01", amount: "30000.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "90000.00",
          status: 1,
          orderedQuantity: 1,
          fulfilledQuantity: 0,
        },
      ],
      referenceDate: REF,
    });

    const lines = listEffectiveReceivableLinesFromSchedule({
      schedule,
      referenceDate: REF,
    });
    assert.equal(lines.length, 3);
    assert.ok(lines.every((l) => l.lineKind === "ORDER_PLAN_FORECAST"));

    const months = ["2026-08", "2026-09", "2026-10"];
    const row = buildMonthlyReceivablesRowFromLines({
      salesOrderId: "so-1",
      orderCode: "PD 09000",
      customerName: "Cliente",
      issueDate: "2026-07-01",
      sellerName: "Ana",
      status: "SENT_TO_NOMUS",
      statusLabel: "Enviado",
      orderCommercialTotal: 90_000,
      monthKeys: months,
      lines,
    });
    assert.equal(row.months["2026-08"]!.amount, 30_000);
    assert.equal(row.months["2026-08"]!.titleCount, 1);
    assert.equal(row.months["2026-09"]!.amount, 30_000);
    assert.equal(row.months["2026-10"]!.amount, 30_000);
    assert.equal(row.periodScheduleTotal, 90_000);
    assert.equal(row.outsidePeriodTotal, 0);
  });

  it("pedido com um CR: CR real + previsões residuais (paridade FIN-08)", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-2",
      orderCode: "PD 09001",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "30000.00" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "30000.00" },
        { installmentNumber: 3, dueDate: "2026-10-01", amount: "30000.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "90000.00",
          status: 3,
          orderedQuantity: 3,
          fulfilledQuantity: 1,
          documentAllocations: [
            { allocationKey: "doc-1", allocatedByOrderPrice: "30000.00" },
          ],
          crAllocations: [
            {
              allocationKey: "cr-1",
              amountReceivable: "30000.00",
              amountReceived: "0",
              balanceReceivable: "30000.00",
            },
          ],
        },
      ],
      documents: [
        {
          documentKey: "doc-1",
          sourceInvoiceId: 100,
          allocatedByOrderPrice: "30000.00",
          provenInstallments: [
            { installmentNumber: 1, dueDate: "2026-08-15", amount: "30000.00" },
          ],
        },
      ],
      realReceivables: [
        {
          externalId: 5001,
          sourceInvoiceId: 100,
          dueDate: "2026-08-15",
          amountReceivable: "30000.00",
          amountReceived: "0",
          balanceReceivable: "30000.00",
        },
      ],
      referenceDate: REF,
    });

    const viaReport = listEffectiveReceivableLinesFromSchedule({
      schedule,
      referenceDate: REF,
    });
    const viaAr = buildFinanceArEffectiveTitles({
      nomusRows: nomusFromScheduleCr(schedule),
      orderContexts: [{ schedule }],
      referenceDate: REF,
    }).items;

    assert.equal(viaReport.length, viaAr.length);
    const reportSum = viaReport.reduce((s, l) => s + l.amountReceivable, 0);
    const arSum = viaAr.reduce((s, l) => s + l.amountReceivable, 0);
    assert.equal(reportSum, arSum);

    const crLines = viaReport.filter((l) => l.lineKind === "CR_REAL");
    const forecast = viaReport.filter(
      (l) =>
        l.lineKind === "ORDER_RESIDUAL_FORECAST" ||
        l.lineKind === "ORDER_PLAN_FORECAST"
    );
    assert.equal(crLines.length, 1);
    assert.ok(forecast.length >= 1);
    assert.equal(yearMonthKeyFromDueIso(crLines[0]!.dueDate), "2026-08");
  });

  it("CR com vencimento diferente da previsão usa mês do CR", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-3",
      orderCode: "PD 09002",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-09-01", amount: "10000.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "10000.00",
          status: 4,
          orderedQuantity: 1,
          fulfilledQuantity: 1,
          documentAllocations: [
            { allocationKey: "doc-1", allocatedByOrderPrice: "10000.00" },
          ],
          crAllocations: [
            {
              allocationKey: "cr-1",
              amountReceivable: "10000.00",
              amountReceived: "0",
              balanceReceivable: "10000.00",
            },
          ],
        },
      ],
      documents: [
        {
          documentKey: "doc-1",
          sourceInvoiceId: 200,
          allocatedByOrderPrice: "10000.00",
          provenInstallments: [
            { installmentNumber: 1, dueDate: "2026-10-20", amount: "10000.00" },
          ],
        },
      ],
      realReceivables: [
        {
          externalId: 6001,
          sourceInvoiceId: 200,
          dueDate: "2026-10-20",
          amountReceivable: "10000.00",
          amountReceived: "0",
          balanceReceivable: "10000.00",
        },
      ],
      referenceDate: REF,
    });

    const lines = listEffectiveReceivableLinesFromSchedule({
      schedule,
      referenceDate: REF,
    });
    const row = buildMonthlyReceivablesRowFromLines({
      salesOrderId: "so-3",
      orderCode: "PD 09002",
      customerName: "Cliente",
      issueDate: null,
      sellerName: "—",
      status: "SENT_TO_NOMUS",
      statusLabel: "Enviado",
      orderCommercialTotal: 10_000,
      monthKeys: ["2026-09", "2026-10"],
      lines,
    });
    assert.equal(row.months["2026-09"]!.amount, 0);
    assert.equal(row.months["2026-10"]!.amount, 10_000);
    assert.equal(row.months["2026-10"]!.titleCount, 1);
  });

  it("vários títulos no mesmo mês somam valor e quantidade", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-4",
      orderCode: "PD 09003",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "5000.00" },
        { installmentNumber: 2, dueDate: "2026-08-15", amount: "5000.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "10000.00",
          status: 1,
          orderedQuantity: 1,
          fulfilledQuantity: 0,
        },
      ],
      referenceDate: REF,
    });
    const lines = listEffectiveReceivableLinesFromSchedule({
      schedule,
      referenceDate: REF,
    });
    const row = buildMonthlyReceivablesRowFromLines({
      salesOrderId: "so-4",
      orderCode: "PD 09003",
      customerName: "Cliente",
      issueDate: null,
      sellerName: "—",
      status: "OPEN",
      statusLabel: "Aberto",
      orderCommercialTotal: 10_000,
      monthKeys: ["2026-08"],
      lines,
    });
    assert.equal(row.months["2026-08"]!.amount, 10_000);
    assert.equal(row.months["2026-08"]!.titleCount, 2);
  });

  it("totais globais independem da página (calculados sobre população filtrada)", () => {
    const months = buildMonthColumns("2026-08", "2026-10");
    const keys = months.map((m) => m.key);
    const makeRow = (code: string, amount: number) =>
      buildMonthlyReceivablesRowFromLines({
        salesOrderId: code,
        orderCode: code,
        customerName: "C",
        issueDate: null,
        sellerName: "—",
        status: "OPEN",
        statusLabel: "Aberto",
        orderCommercialTotal: amount,
        monthKeys: keys,
        lines: listEffectiveReceivableLinesFromSchedule({
          schedule: buildSalesOrderEffectiveFinancialSchedule({
            salesOrderId: code,
            orderCode: code,
            originalInstallments: [
              { installmentNumber: 1, dueDate: "2026-08-01", amount: String(amount) },
            ],
            items: [
              {
                salesOrderItemId: "i",
                plannedNetValue: String(amount),
                status: 1,
                orderedQuantity: 1,
                fulfilledQuantity: 0,
              },
            ],
            referenceDate: REF,
          }),
          referenceDate: REF,
        }),
      });

    const all = [makeRow("A", 1000), makeRow("B", 2000), makeRow("C", 3000)];
    const totalsAll = computeMonthlyReceivablesTotalsFromRows(all, keys);
    const page = all.slice(0, 1);
    const totalsPage = computeMonthlyReceivablesTotalsFromRows(page, keys);
    assert.equal(totalsAll.orderCount, 3);
    assert.equal(totalsAll.periodScheduleTotal, 6000);
    assert.equal(totalsPage.orderCount, 1);
    // contrato: totais do payload usam população filtrada completa, não a página
    assert.notEqual(totalsAll.periodScheduleTotal, totalsPage.periodScheduleTotal);
  });

  it("intervalo padrão = mês atual + 11 meses", () => {
    const range = defaultDueMonthRange(new Date(2026, 6, 17));
    assert.equal(range.dueMonthFrom, "2026-07");
    assert.equal(range.dueMonthTo, "2027-06");
    assert.equal(formatYearMonthKey(2026, 7), "2026-07");
  });

  it("filtro inicial da UI = ano calendário (emissão + vencimento)", () => {
    const filters = defaultMonthlyReceivablesYearFilters(new Date(2026, 6, 17));
    assert.equal(filters.year, 2026);
    assert.equal(filters.dueMonthFrom, "2026-01");
    assert.equal(filters.dueMonthTo, "2026-12");
    assert.equal(filters.startDate, "2026-01-01");
    assert.equal(filters.endDate, "2026-12-31");
  });

  it("mês corrente YYYY-MM e scrollLeft alinham após colunas sticky", () => {
    assert.equal(currentYearMonthKey(new Date(2026, 6, 23)), "2026-07");
    assert.equal(
      scrollLeftToAlignMonthAfterSticky({
        monthOffsetLeft: 820,
        stickyRightOffset: 440,
      }),
      380
    );
    assert.equal(
      scrollLeftToAlignMonthAfterSticky({
        monthOffsetLeft: 100,
        stickyRightOffset: 440,
      }),
      0
    );
  });

  it("fora do período entra em outsidePeriodTotal", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-5",
      orderCode: "PD 09004",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "4000.00" },
        { installmentNumber: 2, dueDate: "2027-01-01", amount: "6000.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "10000.00",
          status: 1,
          orderedQuantity: 1,
          fulfilledQuantity: 0,
        },
      ],
      referenceDate: REF,
    });
    const lines = listEffectiveReceivableLinesFromSchedule({
      schedule,
      referenceDate: REF,
    });
    const row = buildMonthlyReceivablesRowFromLines({
      salesOrderId: "so-5",
      orderCode: "PD 09004",
      customerName: "C",
      issueDate: null,
      sellerName: "—",
      status: "OPEN",
      statusLabel: "Aberto",
      orderCommercialTotal: 10_000,
      monthKeys: ["2026-08", "2026-09"],
      lines,
    });
    assert.equal(row.periodScheduleTotal, 4000);
    assert.equal(row.outsidePeriodTotal, 6000);
    assert.equal(row.effectiveScheduleTotal, 10_000);
  });

  it("dois CR reais + previsão residual (substituição parcial PD 02719)", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-pd-02719",
      orderCode: "PD 02719",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-09-10", amount: "155530.00" },
        { installmentNumber: 2, dueDate: "2026-09-20", amount: "155530.00" },
        { installmentNumber: 3, dueDate: "2026-09-30", amount: "155530.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "466590.00",
          status: 4,
          orderedQuantity: 100,
          fulfilledQuantity: 100,
          documentAllocations: [
            { allocationKey: "doc-7311", allocatedByOrderPrice: "158505.00" },
            { allocationKey: "doc-7382", allocatedByOrderPrice: "146974.00" },
          ],
          crAllocations: [
            {
              allocationKey: "cr-17874",
              amountReceivable: "158505.00",
              amountReceived: "1755.00",
              balanceReceivable: "156750.00",
            },
            {
              allocationKey: "cr-18076",
              amountReceivable: "146974.00",
              amountReceived: "0.00",
              balanceReceivable: "146974.00",
            },
          ],
        },
      ],
      documents: [
        {
          documentKey: "doc-7311",
          sourceInvoiceId: 7311,
          allocatedByOrderPrice: "158505.00",
          provenInstallments: [
            { installmentNumber: 1, dueDate: "2026-09-10", amount: "158505.00" },
          ],
        },
        {
          documentKey: "doc-7382",
          sourceInvoiceId: 7382,
          allocatedByOrderPrice: "146974.00",
          provenInstallments: [
            { installmentNumber: 2, dueDate: "2026-09-20", amount: "146974.00" },
          ],
        },
      ],
      realReceivables: [
        {
          externalId: 17874,
          sourceInvoiceId: 7311,
          dueDate: "2026-09-10",
          amountReceivable: "158505.00",
          amountReceived: "1755.00",
          balanceReceivable: "156750.00",
        },
        {
          externalId: 18076,
          sourceInvoiceId: 7382,
          dueDate: "2026-09-20",
          amountReceivable: "146974.00",
          amountReceived: "0.00",
          balanceReceivable: "146974.00",
        },
      ],
      referenceDate: REF,
    });

    const lines = listEffectiveReceivableLinesFromSchedule({
      schedule,
      referenceDate: REF,
    });
    const crCount = lines.filter((l) => l.lineKind === "CR_REAL").length;
    const residualCount = lines.filter(
      (l) => l.lineKind === "ORDER_RESIDUAL_FORECAST"
    ).length;
    assert.equal(crCount, 2);
    assert.equal(residualCount, 1);

    const monthKeys = ["2026-09"];
    const row = buildMonthlyReceivablesRowFromLines({
      salesOrderId: "so-pd-02719",
      orderCode: "PD 02719",
      customerName: "Britania",
      issueDate: "2026-07-01",
      sellerName: "Ana",
      status: "SENT_TO_NOMUS",
      statusLabel: "Enviado",
      orderCommercialTotal: 466_590,
      monthKeys,
      lines,
    });
    assert.equal(row.months["2026-09"]!.titleCount, 3);
    assert.equal(row.months["2026-09"]!.amount, 466_590);
    assert.equal(row.effectiveScheduleTotal, 466_590);
  });

  it("três CR reais substituem todas as previsões", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-full",
      orderCode: "PD 09999",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "30000.00" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "30000.00" },
        { installmentNumber: 3, dueDate: "2026-10-01", amount: "30000.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "90000.00",
          status: 4,
          orderedQuantity: 3,
          fulfilledQuantity: 3,
          documentAllocations: [
            { allocationKey: "d1", allocatedByOrderPrice: "30000.00" },
            { allocationKey: "d2", allocatedByOrderPrice: "30000.00" },
            { allocationKey: "d3", allocatedByOrderPrice: "30000.00" },
          ],
          crAllocations: [
            { allocationKey: "c1", amountReceivable: "30000", amountReceived: "0", balanceReceivable: "30000" },
            { allocationKey: "c2", amountReceivable: "30000", amountReceived: "0", balanceReceivable: "30000" },
            { allocationKey: "c3", amountReceivable: "30000", amountReceived: "0", balanceReceivable: "30000" },
          ],
        },
      ],
      documents: [
        {
          documentKey: "d1",
          sourceInvoiceId: 1,
          allocatedByOrderPrice: "30000.00",
          provenInstallments: [{ installmentNumber: 1, dueDate: "2026-08-01", amount: "30000.00" }],
        },
        {
          documentKey: "d2",
          sourceInvoiceId: 2,
          allocatedByOrderPrice: "30000.00",
          provenInstallments: [{ installmentNumber: 2, dueDate: "2026-09-01", amount: "30000.00" }],
        },
        {
          documentKey: "d3",
          sourceInvoiceId: 3,
          allocatedByOrderPrice: "30000.00",
          provenInstallments: [{ installmentNumber: 3, dueDate: "2026-10-01", amount: "30000.00" }],
        },
      ],
      realReceivables: [
        { externalId: 1, sourceInvoiceId: 1, dueDate: "2026-08-01", amountReceivable: "30000", amountReceived: "0", balanceReceivable: "30000" },
        { externalId: 2, sourceInvoiceId: 2, dueDate: "2026-09-01", amountReceivable: "30000", amountReceived: "0", balanceReceivable: "30000" },
        { externalId: 3, sourceInvoiceId: 3, dueDate: "2026-10-01", amountReceivable: "30000", amountReceived: "0", balanceReceivable: "30000" },
      ],
      referenceDate: REF,
    });

    const lines = listEffectiveReceivableLinesFromSchedule({
      schedule,
      referenceDate: REF,
    });
    assert.equal(lines.filter((l) => l.lineKind === "CR_REAL").length, 3);
    assert.ok(
      !lines.some(
        (l) =>
          l.lineKind === "ORDER_PLAN_FORECAST" ||
          l.lineKind === "ORDER_RESIDUAL_FORECAST"
      )
    );
  });
});

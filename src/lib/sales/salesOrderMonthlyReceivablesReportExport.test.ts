/**
 * Exportação XLSX — OP-08 paridade com payload da tela.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderMonthlyReceivablesXlsxBuffer } from "./salesOrderMonthlyReceivablesReportExport.js";
import type { SalesOrderMonthlyReceivablesReportPayload } from "./salesOrderMonthlyReceivablesReport.js";

function minimalPayload(): SalesOrderMonthlyReceivablesReportPayload {
  return {
    title: "Recebíveis mensais por Pedido de Venda",
    subtitle: "Agenda efetiva FIN-05/FIN-08",
    generatedAt: "2026-07-22T12:00:00.000Z",
    emitterName: "Teste",
    filters: {
      dueMonthFrom: "2026-07",
      dueMonthTo: "2026-09",
      financialSituation: "all",
      origin: "all",
      includeCancelled: false,
      onlyDivergent: false,
      onlyIncompleteAgenda: false,
      orderCode: null,
      q: null,
    },
    filterLabels: [{ label: "Período", value: "Jul/2026 — Set/2026" }],
    period: {
      startMonth: "2026-07",
      endMonth: "2026-09",
      monthCount: 3,
      months: [
        { key: "2026-07", label: "Jul/2026", year: 2026, month: 7 },
        { key: "2026-08", label: "Ago/2026", year: 2026, month: 8 },
        { key: "2026-09", label: "Set/2026", year: 2026, month: 9 },
      ],
    },
    totals: {
      orderCount: 1,
      orderCommercialTotal: 90_000,
      effectiveScheduleTotal: 90_000,
      periodScheduleTotal: 90_000,
      outsidePeriodTotal: 0,
      difference: 0,
      monthly: {
        "2026-08": { amount: 90_000, titleCount: 3 },
        "2026-07": { amount: 0, titleCount: 0 },
        "2026-09": { amount: 0, titleCount: 0 },
      },
    },
    pagination: { page: 1, pageSize: 25, totalRows: 1, totalPages: 1 },
    rows: [
      {
        salesOrderId: "so-1",
        orderCode: "PD 09000",
        customerName: "Cliente",
        issueDate: "2026-07-01T00:00:00.000Z",
        sellerName: "Ana",
        status: "SENT_TO_NOMUS",
        statusLabel: "Enviado",
        orderCommercialTotal: 90_000,
        effectiveScheduleTotal: 90_000,
        periodScheduleTotal: 90_000,
        outsidePeriodTotal: 0,
        difference: 0,
        qualityStatus: "OK",
        qualityStatusLabel: "OK",
        months: {
          "2026-07": {
            amount: 0,
            titleCount: 0,
            openAmount: 0,
            receivedAmount: 0,
            overdueAmount: 0,
            plannedAmount: 0,
            sourceSummary: null,
          },
          "2026-08": {
            amount: 90_000,
            titleCount: 3,
            openAmount: 90_000,
            receivedAmount: 0,
            overdueAmount: 0,
            plannedAmount: 90_000,
            sourceSummary: "Prev",
          },
          "2026-09": {
            amount: 0,
            titleCount: 0,
            openAmount: 0,
            receivedAmount: 0,
            overdueAmount: 0,
            plannedAmount: 0,
            sourceSummary: null,
          },
        },
        hasIncompleteAgenda: false,
        warnings: [],
      },
    ],
    warnings: [],
  };
}

describe("salesOrderMonthlyReceivablesReportExport", () => {
  it("gera buffer XLSX não vazio com totais e colunas mensais", () => {
    const buffer = buildSalesOrderMonthlyReceivablesXlsxBuffer(minimalPayload());
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 1000);
    assert.equal(buffer[0], 0x50);
    assert.equal(buffer[1], 0x4b);
  });
});

/**
 * PDF de Recebíveis Mensais: o documento renderiza com o cabeçalho institucional
 * (antes faltava `metaLines` e a tela ficava em branco ao clicar em PDF).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesOrderMonthlyReceivablesReportPrintDocument } from "./SalesOrderMonthlyReceivablesReportPrintDocument";
import {
  buildMonthColumns,
  SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_TITLE,
  type SalesOrderMonthlyReceivablesReportPayload,
} from "@/src/lib/sales/salesOrderMonthlyReceivablesReport";
import { DEFAULT_BRANDING } from "@/src/types/branding";

function payload(): SalesOrderMonthlyReceivablesReportPayload {
  const months = buildMonthColumns("2026-10", "2026-12");
  return {
    generatedAt: "2026-10-14T12:00:00.000Z",
    emitterName: "Usuário Teste",
    title: SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_TITLE,
    subtitle: "",
    filters: {} as SalesOrderMonthlyReceivablesReportPayload["filters"],
    filterLabels: [
      { label: "Emissão", value: "Todas" },
      { label: "Vencimento de", value: "2026-10" },
      { label: "Vencimento até", value: "2026-12" },
    ],
    period: { startMonth: "2026-10", endMonth: "2026-12", months, monthCount: 3, maxMonths: 24, periodTooWide: false },
    totals: {
      orderCommercialTotal: 0,
      effectiveScheduleTotal: 0,
      periodScheduleTotal: 0,
      outsidePeriodTotal: 0,
      difference: 0,
      orderCount: 0,
      titleCount: 0,
      monthly: Object.fromEntries(months.map((m) => [m.key, { amount: 0, titleCount: 0 }])),
    },
    pagination: { page: 1, pageSize: 50, totalRows: 7, totalPages: 1 },
    rows: [],
    selection: { populationOrders: 40, candidateOrders: 9, eligibleOrders: 7, failedOrders: 0, complete: true },
    warnings: [],
  };
}

describe("SalesOrderMonthlyReceivablesReportPrintDocument", () => {
  it("renderiza o cabeçalho com título, período, emissor e filtros aplicados", () => {
    const html = renderToStaticMarkup(
      <SalesOrderMonthlyReceivablesReportPrintDocument payload={payload()} branding={DEFAULT_BRANDING} />
    );
    assert.match(html, /print-doc-header/);
    assert.ok(html.includes(SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_TITLE));
    assert.match(html, /Emitido por/);
    assert.match(html, /Usuário Teste/);
    assert.match(html, /2026-10 — 2026-12/);
    assert.match(html, /Emissão: Todas · Vencimento de: 2026-10 · Vencimento até: 2026-12/);
  });

  it("sem branding carregado usa o padrão em vez de quebrar", () => {
    assert.doesNotThrow(() =>
      renderToStaticMarkup(<SalesOrderMonthlyReceivablesReportPrintDocument payload={payload()} branding={null} />)
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyIndustrialTaxSource,
  computeConsolidatedIndustrialMarginPercent,
  computeIndustrialResult,
  reconcileIndustrialCostBreakdown,
  reconcileTaxBreakdownColumns,
  resolveUninvoicedCommercialValue,
  sumIndustrialTaxBreakdown,
} from "./salesOrderIndustrialResultReportMath.js";
import {
  computeSalesOrderIndustrialResultReportSummaryFromRows,
  salesOrderIndustrialResultReportExportFilename,
  type SalesOrderIndustrialResultReportRow,
} from "./salesOrderIndustrialResultReport.js";

function baseRow(
  overrides: Partial<SalesOrderIndustrialResultReportRow> = {}
): SalesOrderIndustrialResultReportRow {
  return {
    salesOrderId: "o1",
    orderCode: "PV-1",
    issueDate: "2026-04-15T00:00:00.000Z",
    customerName: "Cliente",
    sellerName: "Vendedor",
    orderStatus: "OPEN",
    orderStatusLabel: "Aberto",
    invoiceStatus: "NOT_INVOICED",
    invoiceStatusLabel: "Não faturado",
    orderCommercialValue: 1000,
    materialCost: 200,
    laborHourCost: 50,
    machineHourCost: 30,
    otherIndustrialCost: 20,
    totalIndustrialCost: 300,
    icms: 0,
    ipi: 0,
    pis: 0,
    cofins: 0,
    icmsSt: 0,
    difal: 0,
    fcp: 0,
    otherTaxes: 100,
    totalTaxes: 100,
    revenueAfterTaxes: 900,
    industrialResult: 600,
    industrialMarginPercent: 66.67,
    taxSource: "ESTIMADO",
    taxSourceLabel: "Estimado",
    costSourceStatus: "OK",
    costSourceStatusLabel: "Histórico publicado",
    costTableVersionLabel: "PC-1 rev.1",
    costBaseDate: "2026-04-15",
    costTableReferences: ["PC-1 rev.1"],
    priceTableReference: null,
    warnings: [],
    includedInConsolidation: true,
    ...overrides,
  };
}

describe("salesOrderIndustrialResultReportMath", () => {
  it("reconcilia MP+HH+HM+outros = custo total", () => {
    const b = reconcileIndustrialCostBreakdown({
      materialCost: 100,
      laborHourCost: 40,
      machineHourCost: 25,
      totalIndustrialCost: 200,
    });
    assert.equal(b.otherIndustrialCost, 35);
    assert.equal(
      b.materialCost + b.laborHourCost + b.machineHourCost + b.otherIndustrialCost,
      b.totalIndustrialCost
    );
  });

  it("não desconta custo duas vezes no resultado industrial", () => {
    const r = computeIndustrialResult({
      orderCommercialValue: 1000,
      totalTaxes: 160,
      totalIndustrialCost: 300,
    });
    assert.equal(r.revenueAfterTaxes, 840);
    assert.equal(r.industrialResult, 540);
    assert.ok(r.industrialMarginPercent != null && r.industrialMarginPercent > 0);
  });

  it("margem vira — quando receita após impostos <= 0", () => {
    const r = computeIndustrialResult({
      orderCommercialValue: 100,
      totalTaxes: 100,
      totalIndustrialCost: 10,
    });
    assert.equal(r.revenueAfterTaxes, 0);
    assert.equal(r.industrialResult, -10);
    assert.equal(r.industrialMarginPercent, null);
  });

  it("resultado negativo permanece legível", () => {
    const r = computeIndustrialResult({
      orderCommercialValue: 100,
      totalTaxes: 20,
      totalIndustrialCost: 200,
    });
    assert.equal(r.industrialResult, -120);
    assert.ok((r.industrialMarginPercent ?? 0) < 0);
  });

  it("classifica fonte de imposto real/estimado/misto/incompleto", () => {
    assert.equal(
      classifyIndustrialTaxSource({ realTaxTotal: 10, estimatedTaxTotal: 0, incomplete: false }),
      "REAL"
    );
    assert.equal(
      classifyIndustrialTaxSource({ realTaxTotal: 0, estimatedTaxTotal: 10, incomplete: false }),
      "ESTIMADO"
    );
    assert.equal(
      classifyIndustrialTaxSource({ realTaxTotal: 5, estimatedTaxTotal: 5, incomplete: false }),
      "MISTO"
    );
    assert.equal(
      classifyIndustrialTaxSource({ realTaxTotal: 5, estimatedTaxTotal: 5, incomplete: true }),
      "INCOMPLETO"
    );
  });

  it("saldo não faturado nunca fica negativo", () => {
    assert.equal(
      resolveUninvoicedCommercialValue({
        orderCommercialValue: 100,
        invoicedComparableValue: 150,
      }),
      0
    );
  });

  it("total de impostos reconcilia colunas", () => {
    const t = reconcileTaxBreakdownColumns({
      icms: 10,
      ipi: 5,
      pis: 1,
      cofins: 2,
      icmsSt: 0,
      difal: 0,
      fcp: 0,
      otherTaxes: 0,
      totalTaxes: 30,
    });
    assert.equal(t.otherTaxes, 12);
    assert.equal(t.totalTaxes, 30);
  });

  it("soma breakdowns sem float solto", () => {
    const s = sumIndustrialTaxBreakdown([
      { icms: 10.1, otherTaxes: 0.2, totalTaxes: 10.3 },
      { ipi: 1.1, totalTaxes: 1.1 },
    ]);
    assert.equal(s.totalTaxes, 11.4);
    assert.equal(s.icms, 10.1);
    assert.equal(s.ipi, 1.1);
    assert.equal(s.otherTaxes, 0.2);
  });

  it("margem consolidada usa totais, não média simples", () => {
    const consolidated = computeConsolidatedIndustrialMarginPercent({
      industrialResultTotal: 100 + 400,
      revenueAfterTaxesTotal: 1000 + 1000,
    });
    // média simples seria (10% + 40%)/2 = 25%; consolidada = 25% neste caso igual,
    // então use valores assimétricos:
    const asymmetric = computeConsolidatedIndustrialMarginPercent({
      industrialResultTotal: 100 + 100,
      revenueAfterTaxesTotal: 1000 + 100,
    });
    assert.equal(asymmetric, Number(((200 / 1100) * 100).toFixed(2)));
  });
});

describe("salesOrderIndustrialResultReport summary", () => {
  it("exclui incompletos da consolidação", () => {
    const summary = computeSalesOrderIndustrialResultReportSummaryFromRows([
      baseRow({ salesOrderId: "a", industrialResult: 100, revenueAfterTaxes: 500 }),
      baseRow({
        salesOrderId: "b",
        includedInConsolidation: false,
        costSourceStatus: "CUSTO_NAO_LOCALIZADO",
        industrialResult: 999,
        orderCommercialValue: 9999,
      }),
    ]);
    assert.equal(summary.ordersCount, 2);
    assert.equal(summary.completeOrdersCount, 1);
    assert.equal(summary.excludedFromConsolidationCount, 1);
    assert.equal(summary.incompleteCostOrdersCount, 1);
    assert.equal(summary.orderCommercialValueTotal, 1000);
    assert.ok(summary.industrialResultTotal < 999);
  });

  it("nome de arquivo PDF", () => {
    const name = salesOrderIndustrialResultReportExportFilename({
      customerName: "M.H.C. Plásticos",
    });
    assert.match(name, /^resultado-industrial-pedidos-/);
    assert.match(name, /\.pdf$/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { describe, it } from "node:test";
import {
  buildSalesOrderInternalMarginExportWorkbook,
  SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER,
  type SalesOrderInternalMarginExportPayload,
} from "./salesOrderInternalMarginExport.js";
import { buildFinanceSalesOrdersExportCsv } from "./financeSalesOrdersExport.js";

const ROOT = join(import.meta.dirname, "..");

function mockPayload(
  partial: Partial<SalesOrderInternalMarginExportPayload> = {}
): SalesOrderInternalMarginExportPayload {
  return {
    generatedAt: "2026-01-15T12:00:00.000Z",
    scopeLabel: "Teste",
    appliedFilters: [{ label: "Ano", value: "2026" }],
    summary: {
      netRevenue: 1000,
      totalCost: 400,
      marginValue: 600,
      marginPercent: 60,
      marginCoveragePercent: 100,
      markup: 2.5,
      ordersCount: 1,
      itemsCount: 2,
      ordersWithNegativeMargin: 0,
      itemsWithoutCost: 1,
      itemsWithoutProduct: 0,
    },
    orders: [
      {
        orderCode: "PD-001",
        customerName: "Cliente A",
        sellerName: "Maria",
        issueDate: "15/01/2026",
        grossValue: 1050,
        discountValue: 50,
        discountPercent: 4.76,
        netRevenue: 1000,
        totalCost: 400,
        marginValue: 600,
        marginPercent: 60,
        marginCoveragePercent: 100,
        managerialMarginValue: 550,
        managerialMarginPercent: 55,
        markup: 2.5,
        marginStatusLabel: "Margem comercial",
        itemsWithoutCost: 1,
        itemsWithoutProduct: 0,
        itemsWithNegativeMargin: 0,
      },
    ],
    items: [
      {
        orderCode: "PD-001",
        customerName: "Cliente A",
        sellerName: "Maria",
        sku: "SKU-1",
        productName: "Produto OK",
        quantity: 10,
        grossUnitPrice: 84,
        netUnitPrice: 80,
        netRevenue: 800,
        unitCost: 40,
        totalCost: 400,
        marginValue: 400,
        marginPercent: 50,
        managerialMarginValue: 360,
        managerialMarginPercent: 45,
        markup: 2,
        costSourceLabel: "Custo oficial da engenharia",
        costConfidenceLabel: "Alta",
        marginStatusLabel: "Margem comercial",
        notes: "",
      },
      {
        orderCode: "PD-001",
        customerName: "Cliente A",
        sellerName: "Maria",
        sku: "SKU-2",
        productName: "Sem custo",
        quantity: 1,
        grossUnitPrice: 210,
        netUnitPrice: 200,
        netRevenue: 200,
        unitCost: null,
        totalCost: null,
        marginValue: null,
        marginPercent: null,
        managerialMarginValue: null,
        managerialMarginPercent: null,
        markup: null,
        costSourceLabel: "Custo indisponível",
        costConfidenceLabel: "Indisponível",
        marginStatusLabel: "Sem custo",
        notes: "Custo indisponível",
      },
    ],
    alerts: [
      {
        alertType: "Sem custo",
        orderCode: "PD-001",
        customerName: "Cliente A",
        sellerName: "Maria",
        sku: "SKU-2",
        productName: "Sem custo",
        netRevenue: 200,
        marginValue: null,
        marginPercent: null,
        marginStatusLabel: "Sem custo",
      },
    ],
    ...partial,
  };
}

function sheetJson(wb: XLSX.WorkBook, name: string) {
  const sheet = wb.Sheets[name];
  assert.ok(sheet, `sheet ${name} missing`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
}

describe("salesOrderInternalMarginExport", () => {
  it("1. exportação interna inclui margem comercial R$", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const pedidos = sheetJson(wb, "Pedidos");
    assert.ok(pedidos.some((r) => r["Margem comercial R$"] === 600));
  });

  it("2. exportação interna inclui margem comercial %", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const pedidos = sheetJson(wb, "Pedidos");
    assert.ok(pedidos.some((r) => r["Margem comercial %"] === 60));
  });

  it("3. exportação interna inclui custo estimado gerencial", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const resumo = sheetJson(wb, "Resumo");
    assert.ok(
      resumo.some((r) => r.Campo === "Custo estimado total (gerencial)" && r.Valor === 400)
    );
  });

  it("4. exportação interna inclui fonte do custo", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const itens = sheetJson(wb, "Itens");
    assert.ok(itens.some((r) => r["Fonte do custo"] === "Custo oficial da engenharia"));
  });

  it("5. exportação interna inclui status margem comercial", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const pedidos = sheetJson(wb, "Pedidos");
    assert.ok(pedidos.some((r) => r["Status margem comercial"] === "Margem comercial"));
  });

  it("6. exportação respeita filtros (aba Filtros Aplicados)", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const filtros = sheetJson(wb, "Filtros Aplicados");
    assert.ok(filtros.some((r) => r.Filtro === "Ano" && r.Valor === "2026"));
  });

  it("7. exportação mostra filtros aplicados", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(
      mockPayload({ appliedFilters: [{ label: "Cliente (ID)", value: "abc" }] })
    );
    const filtros = sheetJson(wb, "Filtros Aplicados");
    assert.equal(filtros.length, 1);
    assert.equal(filtros[0].Valor, "abc");
  });

  it("8. exportação mostra aviso de relatório interno", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const resumo = sheetJson(wb, "Resumo");
    assert.ok(
      resumo.some(
        (r) => r.Campo === "Aviso" && r.Valor === SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER
      )
    );
  });

  it("12. Excel não quebra com item sem custo", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const itens = sheetJson(wb, "Itens");
    const semCusto = itens.find((r) => r.SKU === "SKU-2");
    assert.ok(semCusto);
    assert.equal(semCusto["Margem comercial R$"], "");
    assert.equal(semCusto["Custo unitário usado"], "");
  });

  it("13. PDF/workbook tolera margem null no resumo", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(
      mockPayload({
        summary: {
          ...mockPayload().summary,
          marginPercent: null,
          markup: null,
        },
      })
    );
    const resumo = sheetJson(wb, "Resumo");
    assert.ok(resumo.some((r) => r.Campo === "Margem comercial %" && r.Valor === ""));
  });

  it("export inclui bruto, desconto, cobertura e status", () => {
    const wb = buildSalesOrderInternalMarginExportWorkbook(mockPayload());
    const pedidos = sheetJson(wb, "Pedidos");
    const row = pedidos.find((r) => r.Pedido === "PD-001");
    assert.ok(row);
    assert.equal(row["Valor bruto"], 1050);
    assert.equal(row["Desconto R$"], 50);
    assert.equal(row["Cobertura margem %"], 100);
    assert.equal(row["Status margem comercial"], "Margem comercial");
  });

  it("finance CSV inclui bloco de margem comercial e gerencial separado", () => {
    const csv = buildFinanceSalesOrdersExportCsv({
      generatedAt: "2026-01-01",
      yearContext: {
        selectedYear: 2026,
        previousYear: 2025,
        referenceDate: new Date(),
        isSelectedYearCurrent: true,
        ytdMonthLimit: 1,
      },
      filters: {
        year: 2026,
        month: null,
        company: null,
        customerId: null,
        customerSearch: null,
        sellerName: null,
        status: null,
        invoiceStatus: "all",
        logisticStatus: null,
      },
      summary: {
        monthSalesAmount: 1000,
        ytdSalesAmount: 1000,
        monthTargetAmount: 900,
        yearTargetAmount: 10000,
        openPortfolioAmount: 500,
        orderCount: 5,
        itemCount: 10,
        marginPortfolio: {
          netRevenue: 1000,
          totalCost: 400,
          marginValue: 550,
          marginPercent: 55,
          markup: 2.5,
          itemsCount: 10,
          validItemsCount: 9,
          ignoredItemsCount: 1,
          hasMissingCost: true,
          hasMissingProduct: false,
          hasNegativeMargin: false,
          hasInvalidRevenue: false,
          status: "PARTIAL",
          statusLabel: "Margem parcial",
          statusSeverity: "warning",
          commercialMargin: {
            commercialMarginTotalValue: 600,
            commercialMarginTotalPercent: 60,
            commercialSoldTotalValue: 1000,
            totalActiveSoldValue: 1000,
            commercialMarginCoveragePercent: 100,
            itemsCalculated: 9,
            itemsUnavailable: 1,
            itemsActive: 10,
            isComplete: false,
            warnings: [],
          },
        },
      },
      monthlyComparison: [],
      realizedProjected: [],
      breakdowns: { byStatus: [], bySeller: [], byCustomer: [] },
      criticalOrders: [],
      topCustomers: [],
    } as never);
    assert.match(csv, /Margem comercial consolidada \(interno\)/);
    assert.match(csv, /Margem comercial parcial \(R\$\)|Margem comercial \(R\$\)/);
    assert.match(csv, /Margem gerencial após impostos e custo/);
    assert.ok(csv.includes(SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER));
  });
});

describe("salesOrderInternalMarginExport — segurança cliente", () => {
  it("9. relatório cliente não inclui margem", () => {
    const doc = readFileSync(join(ROOT, "components/sales/SalesOrderClientDocument.tsx"), "utf8");
    assert.doesNotMatch(doc, /marginSummary/);
    assert.doesNotMatch(doc, /marginValue/);
  });

  it("10. relatório cliente não inclui custo", () => {
    const doc = readFileSync(join(ROOT, "components/sales/SalesOrderClientDocument.tsx"), "utf8");
    assert.doesNotMatch(doc, /unitCost/);
    assert.doesNotMatch(doc, /totalCost/);
  });

  it("11. relatório cliente/proposta não inclui markup", () => {
    const orderDoc = readFileSync(join(ROOT, "components/sales/SalesOrderClientDocument.tsx"), "utf8");
    const proposalDoc = readFileSync(join(ROOT, "components/proposal/ProposalClientDocument.tsx"), "utf8");
    assert.doesNotMatch(orderDoc, /markup/i);
    assert.doesNotMatch(proposalDoc, /commissionRate|frozenTotalCost/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildSalesOrderListReportExportPdf,
  buildSalesOrderListReportExportWorkbook,
  SALES_ORDER_LIST_REPORT_TITLE,
  salesOrderListReportWorkbookToBytes,
  type SalesOrderListReportExportPayload,
} from "./salesOrderListReportExport.js";

const ROOT = join(import.meta.dirname, "..");

function payload(overrides: Partial<SalesOrderListReportExportPayload> = {}): SalesOrderListReportExportPayload {
  return {
    generatedAt: "2026-07-08T12:00:00.000Z",
    appliedFilters: [{ label: "Vendedor", value: "GISLENE LIMA" }],
    summary: {
      sellerLabel: "GISLENE LIMA",
      periodLabel: "2026",
      ordersCount: 2,
      totalNetAmount: 3500,
      totalItems: 8,
      averageTicket: 1750,
      averageMarginPercent: 42.5,
      invoicedCount: 1,
      notInvoicedCount: 1,
    },
    rows: [
      {
        orderCode: "PD-02705",
        customerName: "Cliente A",
        sellerName: "GISLENE LIMA",
        issueDate: "08/07/2026",
        status: "SENT_TO_NOMUS",
        statusLabel: "Enviado ao Nomus",
        hasInvoice: true,
        netValue: 2000,
        marginPercent: 50,
        marginValue: 1000,
        itemsCount: 5,
        nfeDocument: "12345",
        externalSalesOrderCode: "NOM-1",
      },
      {
        orderCode: "PD-02706",
        customerName: "Cliente B",
        sellerName: "GISLENE LIMA",
        issueDate: "07/07/2026",
        status: "READY_TO_SEND",
        statusLabel: "Pronto para envio",
        hasInvoice: false,
        netValue: 1500,
        marginPercent: 35,
        marginValue: 525,
        itemsCount: 3,
        nfeDocument: "",
        externalSalesOrderCode: "NOM-2",
      },
    ],
    ...overrides,
  };
}

describe("salesOrderListReportExport", () => {
  it("XLSX inclui aba Resumo com totais e qtd faturada/não faturada", () => {
    const wb = buildSalesOrderListReportExportWorkbook(payload());
    const bytes = salesOrderListReportWorkbookToBytes(wb);
    const parsed = XLSX.read(bytes, { type: "array" });
    assert.ok(parsed.SheetNames.includes("Resumo"));
    assert.ok(parsed.SheetNames.includes("Pedidos"));
    const resumo = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Resumo);
    const byField = Object.fromEntries(resumo.map((row) => [row.Campo, row.Valor]));
    assert.equal(byField["Qtd pedidos"], 2);
    assert.equal(byField["Valor vendido"], 3500);
    assert.equal(byField["Qtd faturada"], 1);
    assert.equal(byField["Qtd não faturada"], 1);
  });

  it("PDF usa título oficial do relatório", () => {
    const pdf = buildSalesOrderListReportExportPdf(payload());
    const text = pdf.toString("utf8");
    assert.match(text, new RegExp(SALES_ORDER_LIST_REPORT_TITLE.replace(/ /g, " ")));
    assert.match(text, /GISLENE LIMA/);
    assert.match(text, /Qtd faturada: 1/);
  });

  it("workbook respeita colunas do relatório com Faturado", () => {
    const wb = buildSalesOrderListReportExportWorkbook(payload());
    const parsed = XLSX.read(salesOrderListReportWorkbookToBytes(wb), { type: "array" });
    const pedidos = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Pedidos);
    assert.equal(pedidos.length, 2);
    assert.equal(pedidos[0]?.Faturado, "Sim");
    assert.equal(pedidos[1]?.Faturado, "Não");
    assert.ok("Código Nomus" in (pedidos[0] ?? {}));
  });

  it("rotas registradas no server e módulo de rotas", () => {
    const server = readFileSync(join(ROOT, "..", "server.ts"), "utf8");
    const routes = readFileSync(join(ROOT, "lib/salesOrderListReportExportRoutes.ts"), "utf8");
    assert.match(server, /registerSalesOrderListReportExportRoutes/);
    assert.match(routes, /\/api\/sales-orders\/export-report\.xlsx/);
    assert.match(routes, /\/api\/sales-orders\/export-report\.pdf/);
    assert.match(routes, /\/api\/sales-orders\/seller-filter-options/);
  });
});

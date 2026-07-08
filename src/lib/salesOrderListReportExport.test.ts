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

function paymentFields(overrides: Record<string, unknown> = {}) {
  return {
    paymentConditionLabel: "30/60",
    paymentSourceLabel: "Condição prevista do pedido",
    installmentCount: 2,
    firstDueDate: "08/08/2026",
    lastDueDate: "08/09/2026",
    scheduleText: "2x: 08/08/2026 R$ 1.000,00; 08/09/2026 R$ 1.000,00",
    totalTitlesAmount: 2000,
    financialStatusLabel: "—",
    ...overrides,
  };
}

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
      cashOrdersCount: 0,
      installmentOrdersCount: 1,
      noPaymentInfoCount: 0,
      withRealTitlesCount: 1,
      withForecastOnlyCount: 1,
      reportFirstDueDate: "08/07/2026",
      reportLastDueDate: "08/09/2026",
      totalTitlesAmount: 3500,
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
        ...paymentFields({
          paymentSourceLabel: "Títulos do Contas a Receber",
          financialStatusLabel: "A vencer",
        }),
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
        ...paymentFields({
          paymentConditionLabel: "À vista",
          paymentSourceLabel: "Condição prevista do pedido",
          installmentCount: 1,
          firstDueDate: "07/07/2026",
          lastDueDate: "07/07/2026",
          scheduleText: "À vista",
          totalTitlesAmount: 1500,
        }),
      },
    ],
    paymentOpeningRows: [
      {
        orderCode: "PD-02705",
        customerName: "Cliente A",
        sellerName: "GISLENE LIMA",
        nfeDocument: "12345",
        paymentSourceLabel: "Títulos do Contas a Receber",
        installmentNumber: 1,
        dueDate: "08/08/2026",
        amount: 1000,
        statusLabel: "A vencer",
        settlementDate: "",
        amountReceived: "",
        openBalance: 1000,
      },
      {
        orderCode: "PD-02705",
        customerName: "Cliente A",
        sellerName: "GISLENE LIMA",
        nfeDocument: "12345",
        paymentSourceLabel: "Títulos do Contas a Receber",
        installmentNumber: 2,
        dueDate: "08/09/2026",
        amount: 1000,
        statusLabel: "A vencer",
        settlementDate: "",
        amountReceived: "",
        openBalance: 1000,
      },
    ],
    ...overrides,
  };
}

describe("salesOrderListReportExport", () => {
  it("XLSX inclui aba Resumo com totais e indicadores de pagamento", () => {
    const wb = buildSalesOrderListReportExportWorkbook(payload());
    const bytes = salesOrderListReportWorkbookToBytes(wb);
    const parsed = XLSX.read(bytes, { type: "array" });
    assert.ok(parsed.SheetNames.includes("Resumo"));
    assert.ok(parsed.SheetNames.includes("Pedidos"));
    assert.ok(parsed.SheetNames.includes("Abertura de Pagamentos"));
    const resumo = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Resumo);
    const byField = Object.fromEntries(resumo.map((row) => [row.Campo, row.Valor]));
    assert.equal(byField["Qtd pedidos"], 2);
    assert.equal(byField["Pedidos à vista"], 0);
    assert.equal(byField["Total com títulos reais"], 1);
    assert.equal(byField["Valor total em títulos"], 3500);
  });

  it("PDF inclui resumo de pagamento por pedido", () => {
    const pdf = buildSalesOrderListReportExportPdf(payload());
    const text = pdf.toString("utf8");
    assert.match(text, /Relatorio de Pedidos de Venda por Vendedor/);
    assert.match(text, /GISLENE LIMA/);
    assert.match(text, /Pedidos a vista: 0/);
    assert.match(text, /Condição/);
    assert.match(text, /PD-02705/);
  });

  it("workbook mantém colunas existentes e adiciona pagamento", () => {
    const wb = buildSalesOrderListReportExportWorkbook(payload());
    const parsed = XLSX.read(salesOrderListReportWorkbookToBytes(wb), { type: "array" });
    const pedidos = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Pedidos);
    assert.equal(pedidos.length, 2);
    assert.equal(pedidos[0]?.Faturado, "Sim");
    assert.equal(pedidos[1]?.Faturado, "Não");
    assert.ok("Código Nomus" in (pedidos[0] ?? {}));
    assert.ok("Condição de pagamento" in (pedidos[0] ?? {}));
    assert.ok("Cronograma de pagamento" in (pedidos[0] ?? {}));
    assert.equal(pedidos[0]?.["Fonte condição pagamento"], "Títulos do Contas a Receber");
  });

  it("aba Abertura de Pagamentos contém uma linha por parcela", () => {
    const wb = buildSalesOrderListReportExportWorkbook(payload());
    const parsed = XLSX.read(salesOrderListReportWorkbookToBytes(wb), { type: "array" });
    const opening = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      parsed.Sheets["Abertura de Pagamentos"]
    );
    assert.equal(opening.length, 2);
    assert.equal(opening[0]?.Parcela, 1);
    assert.equal(opening[1]?.Parcela, 2);
  });

  it("server export carrega recebíveis e paymentTerms", () => {
    const server = readFileSync(join(ROOT, "lib/salesOrderListReportExport.server.ts"), "utf8");
    assert.match(server, /paymentTerms/);
    assert.match(server, /loadSalesOrderListReceivablesByNfeExternalIds/);
    assert.match(server, /resolveSalesOrderListPaymentSummary/);
    assert.match(server, /paymentOpeningRows/);
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

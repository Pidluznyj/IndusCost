import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderIndustrialResultReport wiring", () => {
  it("endpoint e registro usam os mesmos filtros canônicos da listagem", () => {
    const service = read("src/lib/sales/salesOrderIndustrialResultReportService.server.ts");
    const routes = read("src/lib/salesOrderIndustrialResultReportRoutes.ts");
    const server = read("server.ts");
    assert.match(service, /parseSalesOrderListQuery/);
    assert.match(service, /resolveSalesOrderListWhere/);
    assert.match(service, /resolveSalesOrderListSellerWhere/);
    assert.match(service, /getEffectiveProductProductionCostsForPairs/);
    assert.match(service, /issueDate/);
    assert.match(service, /allowLiveCostFallback|VERSIONED_PRODUCTION|unitProductionCost/);
    assert.doesNotMatch(service, /buildSalesOrderMarginInputs\(/);
    assert.match(routes, /\/api\/sales-orders\/industrial-result-report/);
    assert.match(routes, /sales_orders|COMMERCIAL_RESOURCE_KEYS\.salesOrders/);
    assert.match(server, /registerSalesOrderIndustrialResultReportRoutes/);
  });

  it("UI reutiliza listExportQuery e botão PDF Resultado Industrial", () => {
    const ui = read("src/components/SalesOrdersModule.tsx");
    assert.match(ui, /sales-orders-export-industrial-result-pdf/);
    assert.match(ui, /PDF — Resultado Industrial/);
    assert.match(ui, /getSalesOrderIndustrialResultReportPayloadUrl\(listExportQuery\)/);
    assert.match(ui, /SalesOrderIndustrialResultReportPrintDocument/);
    assert.match(ui, /exportingIndustrialPdf/);
  });

  it("PDF usa identidade visual e título do resultado industrial", () => {
    const doc = read("src/components/sales/SalesOrderIndustrialResultReportPrintDocument.tsx");
    const meta = read("src/lib/sales/salesOrderIndustrialResultReportPrintMeta.ts");
    const css = read("src/components/sales/sales-order-report-print.css");
    assert.match(meta, /RESULTADO INDUSTRIAL/);
    assert.match(meta, /Relatório de Resultado Industrial/);
    assert.match(doc, /sales-orders-industrial-result-print-document/);
    assert.match(doc, /Resultado industrial/);
    assert.match(doc, /Margem industrial/);
    assert.match(doc, /Quanto sobra/);
    assert.match(doc, /Custos industriais/);
    assert.doesNotMatch(doc, /<th>ICMS<\/th>/);
    assert.doesNotMatch(doc, /<th>Vendedor<\/th>/);
    assert.match(doc, /id="sales-orders-print-root"/);
    assert.match(css, /sales-orders-industrial-print-route/);
    assert.match(css, /A4 landscape/);
  });

  it("custo histórico não usa fallback live e reconcilia breakdown", () => {
    const service = read("src/lib/sales/salesOrderIndustrialResultReportService.server.ts");
    const math = read("src/lib/sales/salesOrderIndustrialResultReportMath.ts");
    assert.match(service, /CUSTO_NAO_LOCALIZADO/);
    assert.match(service, /scaleBreakdown|breakdown/);
    assert.match(math, /reconcileIndustrialCostBreakdown/);
    assert.match(math, /computeIndustrialResult/);
    assert.doesNotMatch(service, /getProductCostAnalysis/);
  });

  it("impostos reais/estimados/misto e NF compartilhada incompleta", () => {
    const service = read("src/lib/sales/salesOrderIndustrialResultReportService.server.ts");
    assert.match(service, /nomusNfeFiscalSummary/);
    assert.match(service, /sharedNfeIds/);
    assert.match(service, /resolveUninvoicedCommercialValue/);
    assert.match(service, /computeSalesTaxAmount/);
    assert.match(service, /classifyIndustrialTaxSource/);
  });

  it("módulo server-only não é importado pelo frontend", () => {
    const ui = read("src/components/SalesOrdersModule.tsx");
    assert.doesNotMatch(ui, /salesOrderIndustrialResultReportService\.server/);
    assert.doesNotMatch(ui, /from ["']@\/src\/lib\/prisma/);
  });
});

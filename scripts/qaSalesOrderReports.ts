/**
 * QA estático — Relatório Comercial > Pedidos de Venda (PDF + XLSX).
 * Uso: npx tsx scripts/qaSalesOrderReports.ts
 *
 * Também roda uma checagem dinâmica em modo fixture (sanity-check da agregação
 * pura sem depender de DATABASE_URL). Quando `DATABASE_URL` estiver disponível
 * e a variável `QA_SALES_REPORTS_LIVE=1` for definida, executa o loader real
 * contra o banco (best-effort).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let failed = 0;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(join(root, rel));
}

function ok(id: string, msg: string) {
  console.log(`OK   ${id} — ${msg}`);
}

function fail(id: string, msg: string) {
  failed += 1;
  console.error(`FAIL ${id} — ${msg}`);
}

// ---------------------------------------------------------------------------
// 1) Estrutura de arquivos + reaproveitamento AR
// ---------------------------------------------------------------------------
function checkFilesPresent() {
  for (const rel of [
    "src/lib/sales/salesOrderReportPrintMeta.ts",
    "src/lib/sales/salesOrderReport.ts",
    "src/lib/sales/salesOrderReportService.server.ts",
    "src/lib/sales/salesOrderReportExport.ts",
    "src/lib/sales/salesOrderReportExportUi.ts",
    "src/lib/salesOrderReportRoutes.ts",
    "src/components/sales/SalesOrderReportPrintCover.tsx",
    "src/components/sales/SalesOrderReportPrintDocument.tsx",
    "src/components/sales/sales-order-report-print.css",
    "docs/sales/sales-order-reports.md",
    "tmp-audits/inspect-sales-order-report-britania.ts",
  ]) {
    if (exists(rel)) ok(`files:${rel}`, "presente");
    else fail(`files:${rel}`, "ausente");
  }
}

// ---------------------------------------------------------------------------
// 2) Rotas registradas no servidor
// ---------------------------------------------------------------------------
function checkRoutesRegistered() {
  const server = read("server.ts");
  if (server.includes("registerSalesOrderReportRoutes(app")) {
    ok("routes:register", "registerSalesOrderReportRoutes registrado no server.ts");
  } else {
    fail("routes:register", "registerSalesOrderReportRoutes não registrado");
  }
  if (server.includes('from "./src/lib/salesOrderReportRoutes.js"')) {
    ok("routes:import", "import de salesOrderReportRoutes presente");
  } else {
    fail("routes:import", "import de salesOrderReportRoutes ausente");
  }

  const routesFile = read("src/lib/salesOrderReportRoutes.ts");
  if (routesFile.includes('"/api/sales-orders/report"')) {
    ok("routes:pdf-payload", "GET /api/sales-orders/report presente");
  } else {
    fail("routes:pdf-payload", "GET /api/sales-orders/report ausente");
  }
  if (routesFile.includes('"/api/sales-orders/report/export.xlsx"')) {
    ok("routes:xlsx", "GET /api/sales-orders/report/export.xlsx presente");
  } else {
    fail("routes:xlsx", "GET /api/sales-orders/report/export.xlsx ausente");
  }
  if (
    routesFile.includes("application/pdf") ||
    routesFile.includes("loadSalesOrderReportPayload")
  ) {
    ok("routes:payload-loader", "rota usa loadSalesOrderReportPayload");
  } else {
    fail("routes:payload-loader", "rota não chama loadSalesOrderReportPayload");
  }
  if (
    routesFile.includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
  ) {
    ok("routes:xlsx-content-type", "Content-Type XLSX correto");
  } else {
    fail("routes:xlsx-content-type", "Content-Type XLSX ausente");
  }
  if (routesFile.includes('requirePermission("sales_orders.view")')) {
    ok("routes:permission", "guard sales_orders.view aplicado");
  } else {
    fail("routes:permission", "guard sales_orders.view ausente");
  }
  if (
    routesFile.includes("Cache-Control") &&
    /no-store/.test(routesFile)
  ) {
    ok("routes:no-store", "Cache-Control no-store presente");
  } else {
    fail("routes:no-store", "Cache-Control no-store ausente");
  }
}

// ---------------------------------------------------------------------------
// 3) Meta institucional (strings verbatim)
// ---------------------------------------------------------------------------
function checkPrintMeta() {
  const meta = read("src/lib/sales/salesOrderReportPrintMeta.ts");
  for (const expected of [
    'SALES_ORDER_REPORT_PRINT_TITLE = "COMERCIAL: PEDIDOS DE VENDA"',
    'SALES_ORDER_REPORT_PRINT_SUBTITLE = "Relatório analítico de pedidos de venda filtrados"',
    'SALES_ORDER_REPORT_PRINT_DATA_SOURCE = "Pedidos de Venda Nomus"',
    'Documento gerado pelo IndusCost',
    'Origem: Nomus Pedidos de Venda',
    'SALES_ORDER_REPORT_PRINT_DOCUMENT_TITLE = "COMERCIAL"',
    'SALES_ORDER_REPORT_PRINT_DOCUMENT_HIGHLIGHT = "PEDIDOS DE VENDA"',
  ]) {
    if (meta.includes(expected)) ok(`meta:${expected.slice(0, 40)}…`, "verbatim");
    else fail(`meta:${expected.slice(0, 40)}…`, "ausente");
  }
}

// ---------------------------------------------------------------------------
// 4) Componente Print + reaproveitamento PrintHeader
// ---------------------------------------------------------------------------
function checkPrintComponents() {
  const cover = read("src/components/sales/SalesOrderReportPrintCover.tsx");
  if (cover.includes("PrintHeader")) {
    ok("cover:PrintHeader", "cover reusa PrintHeader institucional");
  } else {
    fail("cover:PrintHeader", "cover não usa PrintHeader institucional");
  }
  if (cover.includes("SALES_ORDER_REPORT_PRINT_SUBTITLE")) {
    ok("cover:subtitle", "subtitle reaproveitado");
  } else {
    fail("cover:subtitle", "subtitle não vem do meta");
  }
  const doc = read("src/components/sales/SalesOrderReportPrintDocument.tsx");
  for (const kpi of [
    "Pedidos",
    "Valor original",
    "Valor ativo",
    "Valor cancelado",
    "Valor faturado",
    "Saldo pendente",
    "Ticket médio",
    "Pedidos com NF",
    "Pedidos sem NF",
  ]) {
    if (doc.includes(kpi)) ok(`doc:kpi:${kpi}`, "KPI presente");
    else fail(`doc:kpi:${kpi}`, `KPI ${kpi} ausente`);
  }
  for (const col of [
    "Cliente",
    "Empresa",
    "Pedido",
    "Emissão",
    "Entrega",
    "Vendedor",
    "Status",
    "Itens",
    "Valor pedido",
    "Valor ativo",
    "Faturado",
    "Saldo",
  ]) {
    if (doc.includes(`>${col}<`)) ok(`doc:col:${col}`, "coluna do PDF presente");
    else fail(`doc:col:${col}`, `coluna ${col} ausente na tabela do PDF`);
  }
  if (doc.includes("sales-orders-print-total-row")) {
    ok("doc:total-row", "linha de total presente");
  } else {
    fail("doc:total-row", "linha de total ausente");
  }
  if (doc.includes("SALES_ORDER_REPORT_PRINT_FOOTER_NOTE")) {
    ok("doc:footer", "rodapé usa footer institucional");
  } else {
    fail("doc:footer", "rodapé não usa footer institucional");
  }
}

// ---------------------------------------------------------------------------
// 5) Frontend SalesOrdersModule — botões + portal
// ---------------------------------------------------------------------------
function checkFrontendModule() {
  const mod = read("src/components/SalesOrdersModule.tsx");
  // A partir de 2026-07 os botões de exportar são discretos (labels curtos:
  // "Excel", "PDF", "Excel interno (margem)"). Validamos via `data-testid`
  // que é o contrato estável usado por testes de integração.
  const hasXlsxButton = mod.includes(
    'data-testid="sales-orders-export-report-xlsx"'
  );
  const hasPdfButton = mod.includes(
    'data-testid="sales-orders-export-report-pdf"'
  );
  const hasInternalButton = mod.includes(
    'data-testid="sales-orders-export-internal-margin"'
  );
  const hasClearButton = mod.includes('data-testid="sales-orders-clear-filters"');
  if (hasXlsxButton && hasPdfButton && hasInternalButton) {
    ok(
      "ui:buttons",
      "botões de exportar (XLSX, PDF, Excel interno) presentes com data-testid canônico"
    );
  } else {
    fail(
      "ui:buttons",
      `botões de exportar incompletos (xlsx=${hasXlsxButton} pdf=${hasPdfButton} internal=${hasInternalButton})`
    );
  }
  if (hasClearButton) {
    ok("ui:clear-filters", "botão Limpar filtros com data-testid canônico");
  } else {
    fail("ui:clear-filters", "botão Limpar filtros sem data-testid canônico");
  }
  if (mod.includes("sales-orders-print-route")) {
    ok("ui:print-route", "classe sales-orders-print-route aplicada no body");
  } else {
    fail("ui:print-route", "sales-orders-print-route ausente");
  }
  if (mod.includes("SalesOrderReportPrintDocument")) {
    ok("ui:print-doc", "documento de impressão importado");
  } else {
    fail("ui:print-doc", "SalesOrderReportPrintDocument não portalizado");
  }
  if (mod.includes("createPortal") && mod.includes("document.body")) {
    ok("ui:portal", "portal para document.body presente");
  } else {
    fail("ui:portal", "portal para document.body ausente");
  }
  if (
    mod.includes("getSalesOrderReportXlsxUrl") &&
    mod.includes("getSalesOrderReportPayloadUrl")
  ) {
    ok("ui:endpoints", "URLs do relatório apontam para /api/sales-orders/report{,/export.xlsx}");
  } else {
    fail("ui:endpoints", "botões não usam endpoints do novo relatório");
  }
  if (mod.includes("import(\"@prisma") || /from ["']@prisma/.test(mod)) {
    fail("ui:no-prisma", "frontend não deve importar @prisma");
  } else {
    ok("ui:no-prisma", "frontend sem import Prisma");
  }
}

// ---------------------------------------------------------------------------
// 6) Backend service — reuso oficial + regras de status
// ---------------------------------------------------------------------------
function checkBackendService() {
  const svc = read("src/lib/sales/salesOrderReportService.server.ts");
  for (const fn of [
    "parseSalesOrderListQuery",
    "buildSalesOrderListWhereForQuery",
    "resolveSalesOrderListSellerWhere",
    "loadSalesOrderLinkedNfeContextMap",
    "resolveSalesOrderListPaymentSummary",
    "parseNomusSalesOrderItemStatusFromRawItem",
    "loadManualCommercialOwnersForCustomers",
    "buildSalesOrderNomusSellerDto",
    "extractNomusRawItems",
  ]) {
    if (svc.includes(fn)) ok(`svc:${fn}`, "reusado");
    else fail(`svc:${fn}`, `${fn} não reusado`);
  }
  if (svc.includes("CANCELED") && svc.includes("FULFILLED_WITH_CUT")) {
    ok("svc:status-gates", "trata CANCELED e FULFILLED_WITH_CUT");
  } else {
    fail("svc:status-gates", "não trata CANCELED/FULFILLED_WITH_CUT");
  }
  if (/canceledValue\s*[=+]/.test(svc) && /cutValue\s*[+=]/.test(svc)) {
    ok("svc:cancel-cut-values", "acumula canceledValue e cutValue");
  } else {
    fail("svc:cancel-cut-values", "não separa canceledValue/cutValue");
  }
  if (svc.includes("Proposal") || svc.includes("proposal")) {
    fail("svc:no-proposal", "service não deve consultar Proposal como fonte oficial");
  } else {
    ok("svc:no-proposal", "Proposal não é fonte oficial (correto)");
  }

  // Regressão histórica (14/07/2026): o `select` do model `Customer` pedia
  // `cnpj: true` — coluna que NÃO existe no schema (é `taxId`). Isso gerava
  // "Invalid prisma.salesOrder.findMany()" → 500 no endpoint /report.
  // Este check estático impede reintrodução da regressão.
  const svcNoComments = svc
    // remove comentários de bloco e linha ANTES de aplicar regex — assim aceita
    // notas explicativas dentro do objeto sem falso negativo.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const customerSelectMatches = [
    ...svcNoComments.matchAll(/Customer\s*:\s*\{\s*select\s*:\s*\{([^}]+)\}/g),
  ];
  if (customerSelectMatches.length === 0) {
    fail("svc:customer-select", "não achei nenhum Customer.select — layout mudou?");
  } else {
    const offenders = customerSelectMatches
      .map((match) => match[1] ?? "")
      .filter((body) => /\bcnpj\s*:/.test(body));
    if (offenders.length > 0) {
      fail(
        "svc:no-cnpj-select-on-customer",
        `Customer.select ainda pede 'cnpj' (campo inexistente no schema — usar 'taxId'): ${offenders
          .map((body) => body.trim().slice(0, 60))
          .join(" | ")}`
      );
    } else {
      ok(
        "svc:no-cnpj-select-on-customer",
        "Customer.select não pede 'cnpj' (usa 'taxId' — regressão histórica bloqueada)"
      );
    }
    const usesTaxId = customerSelectMatches.some((match) =>
      /\btaxId\s*:\s*true/.test(match[1] ?? "")
    );
    if (usesTaxId) {
      ok("svc:taxId-selected", "Customer.select expõe 'taxId' (CNPJ/CPF oficial)");
    } else {
      fail(
        "svc:taxId-selected",
        "Customer.select não expõe 'taxId' — CNPJ ficará vazio nas rows"
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 7) XLSX — colunas expandidas conforme contrato
// ---------------------------------------------------------------------------
function checkXlsxExport() {
  const xlsx = read("src/lib/sales/salesOrderReportExport.ts");
  for (const col of [
    "Cliente",
    "Empresa",
    "Pedido",
    "ID Nomus pedido",
    "Data emissão",
    "Entrega prevista",
    "Vendedor pedido",
    "ID Nomus vendedor",
    "Responsável comercial",
    "Responsável operacional",
    "Status pedido",
    "Condição de pagamento",
    "Quantidade de itens",
    "Itens ativos",
    "Itens cancelados",
    "Itens com corte",
    "Valor original",
    "Valor cancelado",
    "Valor cortado",
    "Valor ativo",
    "Valor faturado",
    "Saldo pendente ativo",
    "NF emitida",
    "Qtde NF-e",
    "Documentos de saída/NF",
    "Alertas principais",
  ]) {
    if (xlsx.includes(col)) ok(`xlsx:${col}`, "coluna presente");
    else fail(`xlsx:${col}`, `coluna ${col} ausente`);
  }
  if (xlsx.includes('"Pedidos de venda"')) {
    ok("xlsx:sheet-name", 'aba "Pedidos de venda" presente');
  } else {
    fail("xlsx:sheet-name", "aba com nome canônico ausente");
  }
  if (xlsx.includes('"Resumo"')) ok("xlsx:sheet-resumo", 'aba "Resumo" presente');
  else fail("xlsx:sheet-resumo", "aba Resumo ausente");
  if (xlsx.includes('"Filtros"')) ok("xlsx:sheet-filtros", 'aba "Filtros" presente');
  else fail("xlsx:sheet-filtros", "aba Filtros ausente");
  if (xlsx.includes("!freeze") && xlsx.includes("!autofilter")) {
    ok("xlsx:freeze+filter", "freeze pane + autofilter aplicados");
  } else {
    fail("xlsx:freeze+filter", "freeze/autofilter ausente");
  }
  if (xlsx.includes('"R$ #,##0.00"')) {
    ok("xlsx:money-format", "formato monetário BRL aplicado");
  } else {
    fail("xlsx:money-format", "formato monetário BRL ausente");
  }
}

// ---------------------------------------------------------------------------
// 8) URL helpers frontend-safe
// ---------------------------------------------------------------------------
function checkUiHelpers() {
  const ui = read("src/lib/sales/salesOrderReportExportUi.ts");
  for (const fn of [
    "getSalesOrderReportPayloadUrl",
    "getSalesOrderReportXlsxUrl",
    "downloadSalesOrderReportXlsx",
  ]) {
    if (ui.includes(`function ${fn}`) || ui.includes(`function ${fn}(`)) {
      ok(`ui:helper:${fn}`, "helper exportado");
    } else if (ui.includes(fn)) {
      ok(`ui:helper:${fn}`, "helper presente");
    } else {
      fail(`ui:helper:${fn}`, `helper ${fn} ausente`);
    }
  }
  if (ui.includes("@prisma")) fail("ui-helpers:no-prisma", "não deve importar prisma");
  else ok("ui-helpers:no-prisma", "sem prisma");
}

// ---------------------------------------------------------------------------
// 9) Filename convention (pedidos-de-venda-<slug>-YYYY-MM-DD.<ext>)
// ---------------------------------------------------------------------------
function checkFilenameConvention() {
  const shared = read("src/lib/sales/salesOrderReport.ts");
  if (
    shared.includes("salesOrderReportExportFilename") &&
    shared.includes("pedidos-de-venda-")
  ) {
    ok("filename:convention", "pedidos-de-venda-<slug>-YYYY-MM-DD.<ext>");
  } else {
    fail("filename:convention", "convenção de nome não implementada");
  }
}

// ---------------------------------------------------------------------------
// 10) Sanity dinâmico da agregação (fixture)
// ---------------------------------------------------------------------------
async function checkAggregationFixture() {
  const {
    buildSalesOrderReportFilterLabels,
    computeSalesOrderReportSummaryFromRows,
    salesOrderReportExportFilename,
  } = await import("../src/lib/sales/salesOrderReport.js");

  const rows = [
    {
      orderId: "1",
      orderCode: "PD 02339",
      externalSalesOrderCode: null,
      customerName: "Britania Eletrodomesticos SA",
      customerCnpj: null,
      companyName: null,
      issueDate: null,
      expectedDeliveryDate: null,
      sellerName: "Vendedor",
      sellerExternalId: null,
      commercialResponsibleName: null,
      operationalResponsibleName: null,
      status: "SENT_TO_NOMUS",
      statusLabel: "Enviado ao Nomus",
      paymentConditionLabel: "30 dias",
      paymentMethodLabel: "Boleto",
      itemsCount: 4,
      activeItemsCount: 3,
      canceledItemsCount: 1,
      cutItemsCount: 0,
      originalValue: 100000,
      canceledValue: 25000,
      cutValue: 0,
      activeValue: 75000,
      invoicedValue: 50000,
      pendingBalance: 25000,
      hasInvoice: true,
      nfeCount: 1,
      nfeNumbers: ["A"],
      nfeDocument: "A",
      lastNfeDate: null,
      alertsSummary: "",
    },
    {
      orderId: "2",
      orderCode: "PD 02207",
      externalSalesOrderCode: null,
      customerName: "Britania Eletrodomesticos SA",
      customerCnpj: null,
      companyName: null,
      issueDate: null,
      expectedDeliveryDate: null,
      sellerName: "Vendedor",
      sellerExternalId: null,
      commercialResponsibleName: null,
      operationalResponsibleName: null,
      status: "SENT_TO_NOMUS",
      statusLabel: "Enviado ao Nomus",
      paymentConditionLabel: "À vista",
      paymentMethodLabel: "Boleto",
      itemsCount: 4,
      activeItemsCount: 2,
      canceledItemsCount: 2,
      cutItemsCount: 0,
      originalValue: 197030,
      canceledValue: 125625,
      cutValue: 0,
      activeValue: 71405,
      invoicedValue: 71405,
      pendingBalance: 0,
      hasInvoice: true,
      nfeCount: 2,
      nfeNumbers: ["B", "C"],
      nfeDocument: "B, C",
      lastNfeDate: null,
      alertsSummary: "",
    },
  ];

  const summary = computeSalesOrderReportSummaryFromRows(rows as never);
  if (summary.ordersCount === 2) ok("agg:orders-count", "somatório de pedidos");
  else fail("agg:orders-count", `esperado 2, veio ${summary.ordersCount}`);

  if (Math.abs(summary.originalValue - 297030) < 0.01) ok("agg:original-value", "R$ 297.030");
  else fail("agg:original-value", `esperado 297030, veio ${summary.originalValue}`);

  if (Math.abs(summary.activeValue - 146405) < 0.01) ok("agg:active-value", "R$ 146.405");
  else fail("agg:active-value", `esperado 146405, veio ${summary.activeValue}`);

  if (Math.abs(summary.canceledValue - 150625) < 0.01) ok("agg:canceled-value", "R$ 150.625");
  else fail("agg:canceled-value", `esperado 150625, veio ${summary.canceledValue}`);

  if (Math.abs(summary.invoicedValue - 121405) < 0.01) ok("agg:invoiced-value", "R$ 121.405");
  else fail("agg:invoiced-value", `esperado 121405, veio ${summary.invoicedValue}`);

  if (Math.abs(summary.pendingBalance - 25000) < 0.01) ok("agg:pending-balance", "R$ 25.000");
  else fail("agg:pending-balance", `esperado 25000, veio ${summary.pendingBalance}`);

  if (summary.invoicedCount === 2 && summary.notInvoicedCount === 0) {
    ok("agg:invoice-count", "todas com NF");
  } else {
    fail("agg:invoice-count", `invoicedCount=${summary.invoicedCount}`);
  }

  const filterLabels = buildSalesOrderReportFilterLabels({
    customerId: "",
    customerName: "Britania Eletrodomesticos SA",
    status: "",
    sellerKey: "",
    sellerLabel: null,
    startDate: null,
    endDate: null,
    year: 2026,
    month: null,
    search: "",
  });
  const hasCustomer = filterLabels.some((line) => line.label === "Cliente");
  const hasYear = filterLabels.some((line) => line.label === "Ano emissão");
  if (hasCustomer && hasYear) ok("agg:filters", "labels de filtros construídas");
  else fail("agg:filters", "labels de cliente/ano ausentes");

  const localReference = new Date(2026, 6, 13, 12, 0, 0);
  const filenamePdf = salesOrderReportExportFilename({
    format: "pdf",
    customerName: "Britania Eletrodomesticos SA",
    referenceDate: localReference,
  });
  if (filenamePdf === "pedidos-de-venda-britania-eletrodomesticos-sa-2026-07-13.pdf") {
    ok("agg:pdf-filename", filenamePdf);
  } else {
    fail("agg:pdf-filename", `esperado britania slug 2026-07-13, veio ${filenamePdf}`);
  }
  const filenameXlsx = salesOrderReportExportFilename({
    format: "xlsx",
    customerName: null,
    referenceDate: localReference,
  });
  if (filenameXlsx === "pedidos-de-venda-todos-2026-07-13.xlsx") {
    ok("agg:xlsx-filename", filenameXlsx);
  } else {
    fail("agg:xlsx-filename", `esperado slug 'todos' 2026-07-13, veio ${filenameXlsx}`);
  }
}

// ---------------------------------------------------------------------------
// 11) Content-Type ok (indireto via routes.ts) — coberto em checkRoutesRegistered.
// 12) Frontend-safe: SalesOrdersModule sem Prisma — coberto em checkFrontendModule.
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== qaSalesOrderReports (static + fixture) ===\n");
  checkFilesPresent();
  checkRoutesRegistered();
  checkPrintMeta();
  checkPrintComponents();
  checkFrontendModule();
  checkBackendService();
  checkXlsxExport();
  checkUiHelpers();
  checkFilenameConvention();
  await checkAggregationFixture();

  console.log("");
  if (failed === 0) {
    console.log("✔ Todos os checks estáticos e de agregação passaram.");
  } else {
    console.error(`✗ ${failed} check(s) falharam.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

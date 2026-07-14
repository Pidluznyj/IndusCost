/**
 * QA estático — Detalhe do Pedido de Venda (modal + PDF/view).
 *
 * Uso: npx tsx scripts/qaSalesOrderDetailView.ts
 *
 * Valida invariantes de contrato, integração de motores oficiais e
 * ausência de duplicação de regra.
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
// 1) Arquivos presentes
// ---------------------------------------------------------------------------
function checkFilesPresent() {
  for (const rel of [
    "src/lib/sales-orders/salesOrderDetailClient.ts",
    "src/lib/sales-orders/salesOrderDetailService.server.ts",
    "src/lib/salesOrderDetailRoutes.ts",
    "src/components/sales/SalesOrderDetailView.tsx",
    "src/components/sales/SalesOrderDetailDialog.tsx",
    "src/components/sales/sales-order-detail-view.css",
    "docs/sales/sales-order-detail-view.md",
    "tmp-audits/inspect-sales-order-detail-view.ts",
  ]) {
    if (exists(rel)) ok(`files:${rel}`, "presente");
    else fail(`files:${rel}`, "ausente");
  }
}

// ---------------------------------------------------------------------------
// 2) Rota HTTP registrada + ordem correta
// ---------------------------------------------------------------------------
function checkRoutesRegistered() {
  const server = read("server.ts");
  if (server.includes("registerSalesOrderDetailRoutes(app")) {
    ok("routes:register", "registerSalesOrderDetailRoutes registrado no server.ts");
  } else {
    fail("routes:register", "registerSalesOrderDetailRoutes não registrado");
  }
  if (server.includes('from "./src/lib/salesOrderDetailRoutes.js"')) {
    ok("routes:import", "import de salesOrderDetailRoutes presente");
  } else {
    fail("routes:import", "import de salesOrderDetailRoutes ausente");
  }
  // Precisa ser registrada ANTES do inline `app.get("/api/sales-orders/:id"`.
  const idxDetail = server.indexOf("registerSalesOrderDetailRoutes(app");
  const idxInline = server.indexOf('app.get("/api/sales-orders/:id"');
  if (idxDetail > 0 && idxInline > idxDetail) {
    ok("routes:order", "registrar detail vem antes do inline :id");
  } else {
    fail(
      "routes:order",
      "registrar de detail deve vir antes de app.get(\"/api/sales-orders/:id\")"
    );
  }

  const routes = read("src/lib/salesOrderDetailRoutes.ts");
  if (routes.includes('"/api/sales-orders/:salesOrderId/detail"')) {
    ok("routes:path", "GET /api/sales-orders/:salesOrderId/detail presente");
  } else {
    fail("routes:path", "endpoint /detail ausente");
  }
  if (
    routes.includes("sales_orders.detail.view") &&
    routes.includes("sales_orders.view")
  ) {
    ok("routes:auth", "guard sales_orders.detail.view/sales_orders.view aplicado");
  } else {
    fail("routes:auth", "guard de permissão ausente");
  }
}

// ---------------------------------------------------------------------------
// 3) Service reutiliza motores oficiais (não duplica regra)
// ---------------------------------------------------------------------------
function checkServiceReusesOfficialEngines() {
  const svc = read("src/lib/sales-orders/salesOrderDetailService.server.ts");
  const requiredImports = [
    "getOrderFullAudit",
    "resolveSalesOrderBillingStatus",
    "salesOrderBillingStatusLabel",
    "formatNomusItemStatusNormalized",
  ];
  for (const fn of requiredImports) {
    if (svc.includes(fn)) ok(`svc:reuses:${fn}`, "consumido");
    else fail(`svc:reuses:${fn}`, `${fn} não é reutilizado`);
  }

  // Frontend-safe: service **server-only** (importa Prisma tipo apenas para
  // tipagem opcional — o loader real chama getOrderFullAudit).
  if (svc.includes("getOrderFullAudit(")) {
    ok("svc:delegates-to-audit", "delega para getOrderFullAudit (orquestrador oficial)");
  } else {
    fail("svc:delegates-to-audit", "não delega para getOrderFullAudit");
  }

  // Não pode recalcular margin/planned localmente.
  if (
    svc.includes("calculateSalesOrderMarginsForOrders(") ||
    svc.includes("buildSalesOrderPlannedReceivables(") ||
    svc.includes("resolveReceivablesForSalesOrder(")
  ) {
    fail(
      "svc:no-duplicate-motors",
      "service duplicou chamada de motor oficial (deveria vir via getOrderFullAudit)"
    );
  } else {
    ok(
      "svc:no-duplicate-motors",
      "service não duplica motores oficiais (delega via getOrderFullAudit)"
    );
  }

  // Contrato do payload deve expor todas as seções principais — check via
  // funções mapeadoras (o objeto usa shorthand com estas variáveis).
  for (const mapper of [
    "mapHeader",
    "mapSummary",
    "mapItem",
    "mapInvoices",
    "mapStockDocuments",
    "mapFinancial",
    "mapPricingMargin",
    "mapAlerts",
  ]) {
    if (svc.includes(mapper)) ok(`svc:payload:${mapper}`, "mapeador definido");
    else fail(`svc:payload:${mapper}`, `mapeador ${mapper} ausente`);
  }
  if (svc.includes("technicalInfo:")) {
    ok("svc:payload:technicalInfo", "technicalInfo presente no payload");
  } else {
    fail("svc:payload:technicalInfo", "technicalInfo ausente no payload");
  }
}

// ---------------------------------------------------------------------------
// 4) Client contract sem Prisma + expõe URL helper
// ---------------------------------------------------------------------------
function checkClientContract() {
  const client = read("src/lib/sales-orders/salesOrderDetailClient.ts");
  if (/@prisma\/client/.test(client)) {
    fail("client:no-prisma", "client importa @prisma/client");
  } else {
    ok("client:no-prisma", "sem Prisma");
  }
  if (client.includes("getSalesOrderDetailUrl")) {
    ok("client:url-helper", "helper de URL exportado");
  } else {
    fail("client:url-helper", "helper de URL ausente");
  }
  for (const type of [
    "SalesOrderDetailPayload",
    "SalesOrderDetailHeader",
    "SalesOrderDetailSummary",
    "SalesOrderDetailItem",
    "SalesOrderDetailInvoice",
    "SalesOrderDetailStockDocument",
    "SalesOrderDetailFinancial",
    "SalesOrderDetailPricingMargin",
    "SalesOrderDetailAlert",
  ]) {
    if (client.includes(type)) ok(`client:type:${type}`, "presente");
    else fail(`client:type:${type}`, `tipo ${type} ausente`);
  }
}

// ---------------------------------------------------------------------------
// 5) UI Modal + View: seções obrigatórias
// ---------------------------------------------------------------------------
function checkUiComponents() {
  const view = read("src/components/sales/SalesOrderDetailView.tsx");
  const dialog = read("src/components/sales/SalesOrderDetailDialog.tsx");

  for (const testId of [
    "sales-order-detail-view",
    "sales-order-detail-header",
    "sales-order-detail-summary",
    "sales-order-detail-items",
    "sales-order-detail-invoices",
    "sales-order-detail-financial",
    "sales-order-detail-pricing-margin",
    "sales-order-detail-alerts",
  ]) {
    if (view.includes(testId)) ok(`ui:view-testid:${testId}`, "presente");
    else fail(`ui:view-testid:${testId}`, `testId ${testId} ausente`);
  }

  for (const testId of [
    "sales-order-detail-dialog",
    "sales-order-detail-close",
    "sales-order-detail-print",
    "sales-order-detail-copy-code",
  ]) {
    if (dialog.includes(testId)) ok(`ui:dialog-testid:${testId}`, "presente");
    else fail(`ui:dialog-testid:${testId}`, `testId ${testId} ausente`);
  }

  // Modal usa portal.
  if (dialog.includes("createPortal") && dialog.includes("document.body")) {
    ok("ui:dialog:portal", "modal portalizado (preserva filtros da lista)");
  } else {
    fail("ui:dialog:portal", "modal não usa createPortal(document.body)");
  }

  // Frontend não pode importar Prisma.
  for (const [id, src] of [
    ["view", view],
    ["dialog", dialog],
  ] as const) {
    if (/@prisma\/client/.test(src)) {
      fail(`ui:${id}:no-prisma`, `${id} importa @prisma/client`);
    } else {
      ok(`ui:${id}:no-prisma`, "sem Prisma");
    }
  }

  // Renderiza cabeçalho com Cliente, Vendedor, Datas, Status faturamento.
  for (const label of [
    "Cliente",
    "Vendedor do pedido",
    "Responsável comercial",
    "Data de emissão",
    "Data de entrega",
    "Status faturamento",
    "Condição de pagamento",
    "Forma de pagamento",
  ]) {
    if (view.includes(label)) ok(`ui:view:label:${label}`, "presente");
    else fail(`ui:view:label:${label}`, `label ${label} ausente`);
  }

  // KPIs de resumo obrigatórios.
  for (const kpi of [
    "Valor pedido",
    "Valor ativo",
    "Valor cancelado",
    "Valor faturado",
    "Saldo pendente",
    "Margem R$",
    "Margem %",
    "Última NF",
  ]) {
    if (view.includes(kpi)) ok(`ui:view:kpi:${kpi}`, "presente");
    else fail(`ui:view:kpi:${kpi}`, `card ${kpi} ausente`);
  }
}

// ---------------------------------------------------------------------------
// 6) Integração no SalesOrdersModule: modal + preservação de filtros
// ---------------------------------------------------------------------------
function checkModuleIntegration() {
  const module = read("src/components/SalesOrdersModule.tsx");
  if (module.includes("SalesOrderDetailDialog")) {
    ok("module:dialog-import", "modal importado");
  } else {
    fail("module:dialog-import", "SalesOrderDetailDialog não importado");
  }
  if (module.includes("openDetail(") && module.includes("closeDetail")) {
    ok("module:handlers", "handlers openDetail/closeDetail definidos");
  } else {
    fail("module:handlers", "handlers openDetail/closeDetail ausentes");
  }
  if (module.includes("<SalesOrderDetailDialog")) {
    ok("module:dialog-mounted", "modal montado no JSX");
  } else {
    fail("module:dialog-mounted", "modal não montado");
  }
  // O onOpenDetail agora abre o modal (não navega mais).
  if (module.includes("openDetail(orderId")) {
    ok("module:on-open-detail-uses-modal", "botão Detalhe abre modal (não navega)");
  } else {
    fail("module:on-open-detail-uses-modal", "botão Detalhe ainda faz navigate()");
  }
}

// ---------------------------------------------------------------------------
// 7) Regra oficial: SalesOrder.responsible não vira responsável comercial
// ---------------------------------------------------------------------------
function checkResponsibleGuard() {
  const view = read("src/components/sales/SalesOrderDetailView.tsx");
  if (
    view.includes("commercialResponsibleName") &&
    view.includes("operationalResponsibleName")
  ) {
    ok(
      "guard:separates-commercial-vs-operational",
      "view distingue responsável comercial (CRM) de responsável operacional (Nomus)"
    );
  } else {
    fail(
      "guard:separates-commercial-vs-operational",
      "view não separa responsável comercial × operacional"
    );
  }
}

async function main() {
  console.log("=== qaSalesOrderDetailView (estático) ===\n");
  checkFilesPresent();
  checkRoutesRegistered();
  checkServiceReusesOfficialEngines();
  checkClientContract();
  checkUiComponents();
  checkModuleIntegration();
  checkResponsibleGuard();

  console.log("");
  if (failed === 0) {
    console.log("✔ Todos os checks passaram.");
  } else {
    console.error(`✗ ${failed} check(s) falharam.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

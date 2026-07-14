/**
 * QA estático + fixture — invariantes de consumo dos motores oficiais
 * pela Auditoria 360º do Pedido.
 *
 * Uso: npx tsx scripts/qaOrderFullAuditOfficialEngines.ts
 *
 * Complementa `scripts/qaOrderFullAuditDialog.ts` (que já cobre estrutura
 * de UI + checks dinâmicos por PD): aqui garantimos que cada aba consome
 * os motores oficiais mapeados em
 * `docs/finance/order-full-audit-official-engines-map.md` e que a façade
 * pública `resolveReceivablesForSalesOrder` está no lugar.
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
// 1) Arquivos obrigatórios
// ---------------------------------------------------------------------------
function checkFilesPresent() {
  for (const rel of [
    "src/lib/finance/orderFullAuditService.ts",
    "src/lib/finance/orderFullAuditClient.ts",
    "src/lib/finance/salesOrderPlannedReceivables.ts",
    "src/lib/finance/orderReceivablesResolver.ts",
    "src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx",
    "docs/finance/order-full-audit-official-engines-map.md",
    "docs/finance/order-full-audit-dialog.md",
    "docs/finance/portfolio-order-status-tab.md",
    "tmp-audits/inspect-order-full-audit-official-engines.ts",
    "tmp-audits/inspect-order-full-audit-pd02740.ts",
    "tmp-audits/inspect-order-full-audit-pd02339.ts",
    "tmp-audits/inspect-order-full-audit-pd02534.ts",
    "tmp-audits/inspect-order-full-audit-pd02207.ts",
  ]) {
    if (exists(rel)) ok(`files:${rel}`, "presente");
    else fail(`files:${rel}`, "ausente");
  }
}

// ---------------------------------------------------------------------------
// 2) Façade oficial de recebíveis exporta o contrato esperado
// ---------------------------------------------------------------------------
function checkOrderReceivablesResolver() {
  const src = read("src/lib/finance/orderReceivablesResolver.ts");

  const requiredExports = [
    "resolveReceivablesForSalesOrder",
    "isOrderInPlannedOnlyState",
    "computeConsolidatedFinancialSummary",
    "OrderReceivablesResolverPayload",
    "OrderReceivablesResolverError",
    "ResolveReceivablesInput",
  ];
  for (const name of requiredExports) {
    if (src.includes(name)) ok(`resolver:export:${name}`, "presente");
    else fail(`resolver:export:${name}`, `export ${name} ausente`);
  }

  // Deve reutilizar getOrderFullAudit (não recriar Prisma).
  if (src.includes('from "./orderFullAuditService.js"') && src.includes("getOrderFullAudit")) {
    ok("resolver:reuses-audit", "façade delega para getOrderFullAudit");
  } else {
    fail("resolver:reuses-audit", "façade não delega ao audit oficial");
  }

  // Não pode importar Prisma diretamente.
  if (/@prisma\/client/.test(src) || /from ["']\.\/prisma/.test(src)) {
    fail("resolver:no-prisma", "façade importa Prisma diretamente");
  } else {
    ok("resolver:no-prisma", "façade não importa Prisma");
  }

  // Deve documentar/apontar as fontes oficiais.
  for (const source of [
    "NomusAccountsReceivable",
    "buildSalesOrderPlannedReceivables",
    "resolveSalesOrderListPaymentSummary",
  ]) {
    if (src.includes(source)) ok(`resolver:source:${source}`, "documenta fonte oficial");
    else fail(`resolver:source:${source}`, `fonte ${source} não mencionada`);
  }

  // Dedup: precisa filtrar planned replaced.
  if (src.includes("replacedByRealCr")) {
    ok("resolver:planned-dedup", "façade oculta planejado replacedByRealCr");
  } else {
    fail("resolver:planned-dedup", "façade não trata replacedByRealCr");
  }

  // Filtragem de divergências por linkedTab.
  if (src.includes('linkedTab === "financial"')) {
    ok("resolver:financial-divergences", "façade filtra divergências financeiras");
  } else {
    fail("resolver:financial-divergences", "façade não filtra alerts financeiros");
  }
}

// ---------------------------------------------------------------------------
// 3) orderFullAuditService integra os motores oficiais esperados
// ---------------------------------------------------------------------------
function checkOfficialEnginesInService() {
  const svc = read("src/lib/finance/orderFullAuditService.ts");
  const requiredImports: Array<[string, string]> = [
    ["nomusSalesOrderItemStatus.js", "helpers oficiais de status de item Nomus"],
    ["orderToCashFactItemStatusEnrichment.server.js", "enrichFactsWithOrderItemStatus"],
    ["crmCustomerCommercialOwner.js", "CRM responsável comercial oficial"],
    ["salesOrderMarginService.server.js", "motor oficial de margem"],
    ["salesOrderListPaymentSchedule.js", "cronograma oficial de pagamento"],
    ["salesOrderPlannedReceivables.js", "forecast oficial de recebíveis planejados"],
  ];
  for (const [pathFragment, humanLabel] of requiredImports) {
    if (svc.includes(pathFragment)) {
      ok(`svc:import:${pathFragment}`, humanLabel);
    } else {
      fail(`svc:import:${pathFragment}`, `${humanLabel} não é importado`);
    }
  }

  // Não pode duplicar buildSalesOrderPlannedReceivables (só chamar).
  const definesLocalPlanned =
    /function\s+buildSalesOrderPlannedReceivables/.test(svc) ||
    /const\s+buildSalesOrderPlannedReceivables\s*=/.test(svc);
  if (definesLocalPlanned) {
    fail(
      "svc:no-local-planned",
      "orderFullAuditService redeclara buildSalesOrderPlannedReceivables"
    );
  } else {
    ok(
      "svc:no-local-planned",
      "orderFullAuditService só consome buildSalesOrderPlannedReceivables (motor oficial)"
    );
  }

  // Deve invocar buildSalesOrderPlannedReceivables para preencher plannedReceivables.
  if (/buildSalesOrderPlannedReceivables\s*\(/.test(svc)) {
    ok("svc:call:planned-forecast", "invoca motor oficial de forecast");
  } else {
    fail("svc:call:planned-forecast", "não invoca buildSalesOrderPlannedReceivables");
  }

  // Deve invocar calculateSalesOrderMarginsForOrders para a aba Margem.
  if (/calculateSalesOrderMarginsForOrders\s*\(/.test(svc)) {
    ok("svc:call:margin-official", "invoca motor oficial de margem");
  } else {
    fail("svc:call:margin-official", "não invoca calculateSalesOrderMarginsForOrders");
  }

  // Deve invocar loadManualCommercialOwnersForCustomers (CRM oficial).
  if (/loadManualCommercialOwnersForCustomers\s*\(/.test(svc)) {
    ok("svc:call:crm-owner", "invoca CRM responsável comercial oficial");
  } else {
    fail("svc:call:crm-owner", "não invoca loadManualCommercialOwnersForCustomers");
  }
}

// ---------------------------------------------------------------------------
// 4) Contrato client (Auditoria 360º) expõe plannedReceivables + total
// ---------------------------------------------------------------------------
function checkClientContract() {
  const client = read("src/lib/finance/orderFullAuditClient.ts");
  for (const type of [
    "OrderFullAuditPlannedReceivable",
    "OrderFullAuditPlannedReceivablesTotal",
    "OrderFullAuditReceivable",
    "OrderFullAuditReceipt",
    "OrderFullAuditAlert",
  ]) {
    if (client.includes(type)) ok(`client:type:${type}`, "presente");
    else fail(`client:type:${type}`, `tipo ${type} ausente`);
  }

  if (client.includes("plannedReceivables:") && client.includes("plannedReceivablesTotal:")) {
    ok("client:payload:planned-fields", "payload expõe plannedReceivables + plannedReceivablesTotal");
  } else {
    fail("client:payload:planned-fields", "payload não expõe plannedReceivables");
  }

  if (/@prisma\/client/.test(client)) {
    fail("client:no-prisma", "orderFullAuditClient importa Prisma");
  } else {
    ok("client:no-prisma", "contrato client sem Prisma");
  }
}

// ---------------------------------------------------------------------------
// 5) UI Financeiro renderiza CR real + planejado + dedup
// ---------------------------------------------------------------------------
function checkFinancialTabUI() {
  const dlg = read("src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx");
  for (const marker of [
    "order-full-audit-financial-section-planned",
    "order-full-audit-financial-planned-table",
    "Recebíveis planejados pelo pedido",
    "Planejado pelo pedido",
    "CR real",
    "Total financeiro",
    'type="PLANNED"',
    'type="REAL_CR"',
  ]) {
    if (dlg.includes(marker)) ok(`ui:financial:${marker}`, "presente");
    else fail(`ui:financial:${marker}`, `marca ${marker} ausente na aba Financeiro`);
  }

  // Aba Financeiro precisa consumir o payload.plannedReceivables.
  if (/plannedReceivables=\{payload\.plannedReceivables\}/.test(dlg)) {
    ok("ui:financial:planned-wired", "FinancialTab consome payload.plannedReceivables");
  } else {
    fail("ui:financial:planned-wired", "FinancialTab não conecta plannedReceivables");
  }
}

// ---------------------------------------------------------------------------
// 6) Códigos de divergência oficiais para financeiro (PLANNED_*)
// ---------------------------------------------------------------------------
function checkPlannedAlertCodes() {
  const svc = read("src/lib/finance/orderFullAuditService.ts");
  const dlg = read("src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx");
  for (const code of [
    "PLANNED_RECEIVABLE_WITHOUT_REAL_CR",
    "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR",
    "PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR",
  ]) {
    if (svc.includes(code)) ok(`alert:svc:${code}`, "emitido no service");
    else fail(`alert:svc:${code}`, `código ${code} não é emitido`);

    if (dlg.includes(code)) ok(`alert:dlg:${code}`, "listado na UI");
    else fail(`alert:dlg:${code}`, `código ${code} não está na UI`);
  }
}

// ---------------------------------------------------------------------------
// 7) Regra: Responsável Comercial nunca aceita "FATURAMENTO"/"FINANCEIRO"
// ---------------------------------------------------------------------------
function checkCommercialResponsibleGuard() {
  const audit = read("src/lib/finance/orderFullAuditService.ts");

  // Existe a lista defensiva OPERATIONAL_SECTOR_KEYWORDS que reconhece rótulos
  // operacionais indevidos ("FATURAMENTO", "FINANCEIRO", etc.). Isso está OK.
  const guardExists =
    /OPERATIONAL_SECTOR_KEYWORDS\s*=\s*\[[^\]]*"FATURAMENTO"[^\]]*"FINANCEIRO"/s.test(audit) &&
    audit.includes("isOperationalSectorName");
  if (guardExists) {
    ok(
      "crm:operational-sector-guard",
      "isOperationalSectorName filtra FATURAMENTO/FINANCEIRO/EXPEDICAO como responsável comercial"
    );
  } else {
    fail(
      "crm:operational-sector-guard",
      "guarda OPERATIONAL_SECTOR_KEYWORDS/isOperationalSectorName ausente"
    );
  }

  // Emissão do alerta oficial quando `SalesOrder.responsible` for setor.
  if (audit.includes("OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE")) {
    ok(
      "crm:operational-alert",
      "emite alerta OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE"
    );
  } else {
    fail(
      "crm:operational-alert",
      "sem alerta OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE"
    );
  }
}

// ---------------------------------------------------------------------------
// 8) Frontend não importa Prisma (checagem do dialog + resolver)
// ---------------------------------------------------------------------------
function checkFrontendNoPrisma() {
  const dlg = read("src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx");
  if (/@prisma\/client/.test(dlg)) {
    fail("frontend:no-prisma", "OrderFullAuditDialog importa Prisma");
  } else {
    ok("frontend:no-prisma", "OrderFullAuditDialog sem import Prisma");
  }
}

// ---------------------------------------------------------------------------
// 9) Runtime fixture — façade compõe corretamente sem I/O real
// ---------------------------------------------------------------------------
async function checkRuntimeFixture() {
  const { computeConsolidatedFinancialSummary, isOrderInPlannedOnlyState } = await import(
    "../src/lib/finance/orderReceivablesResolver.js"
  );

  // Consolidated summary com dados de fixture.
  const summary = computeConsolidatedFinancialSummary({
    totals: {
      totalAmount: 100_000,
      openAmount: 50_000,
      receivedAmount: 50_000,
      overdueCount: 0,
      nextDueDate: null,
      maxAmount: 100_000,
      totalCount: 1,
    },
    plannedTotals: {
      totalCount: 2,
      totalExpected: 75_000,
      openExpected: 75_000,
      overdueExpected: 0,
      overdueCount: 0,
      dueTodayExpected: 0,
      dueTodayCount: 0,
      upcomingCount: 2,
      nextDueDate: "2026-11-01",
      replacedCount: 0,
      replacedAmount: 0,
      netPlannedOpen: 75_000,
    },
  });

  if (summary.totalFinancialValue === 175_000) ok("runtime:consolidated:total", "R$ 175.000");
  else fail("runtime:consolidated:total", `esperado 175000, veio ${summary.totalFinancialValue}`);
  if (summary.totalFinancialOpen === 125_000) ok("runtime:consolidated:open", "R$ 125.000");
  else fail("runtime:consolidated:open", `esperado 125000, veio ${summary.totalFinancialOpen}`);
  if (summary.realCrTotal === 100_000 && summary.plannedTotal === 75_000) {
    ok("runtime:consolidated:split", "separa CR real de planejado");
  } else {
    fail("runtime:consolidated:split", "não separa CR real de planejado");
  }

  // isOrderInPlannedOnlyState — PD 02740-like
  const plannedOnly = isOrderInPlannedOnlyState({
    realReceivables: [],
    plannedReceivables: [
      {
        key: "PD:1:2026-10-20:175600.00",
        orderCode: "PD 02740",
        salesOrderId: "fx",
        installmentNumber: 1,
        totalInstallments: 1,
        reference: "Pedido PD 02740 - Parcela 1 de 1",
        dueDate: "2026-10-20",
        expectedAmount: 175_600,
        openAmount: 175_600,
        statusLabel: "A vencer",
        paymentConditionLabel: "30 dias",
        paymentMethodLabel: "Boleto",
        origin: "Pedido de Venda / Condição de pagamento",
        note: "",
        replacedByRealCr: false,
        replacedByReceivableExternalId: null,
      },
    ],
  });
  if (plannedOnly) ok("runtime:planned-only:pd02740", "cenário planejado-sem-CR detectado");
  else fail("runtime:planned-only:pd02740", "falha ao detectar planejado-sem-CR");

  // Cenário real+planned (não é planned-only)
  const mixed = isOrderInPlannedOnlyState({
    realReceivables: [{ receivableExternalId: 1 } as never],
    plannedReceivables: [
      { replacedByRealCr: false } as never,
    ],
  });
  if (!mixed) ok("runtime:planned-only:mixed", "não confunde com CR real presente");
  else fail("runtime:planned-only:mixed", "reportou planejado-only com CR real presente");

  // --------------------------------------------------------------------
  // Bug PD 02740 (2026-07): parcelas do nomusRawResponse com escala 1000×
  // menor que o `totalNetValue` do pedido eram usadas cegamente, gerando
  // planned R$ 175,60 em vez de R$ 175.600,00. O motor agora reescala
  // preservando a estrutura de parcelas (contagem + datas).
  // --------------------------------------------------------------------
  const { extractSalesOrderForecastInstallments } = await import(
    "../src/lib/salesOrderListPaymentSchedule.js"
  );
  const rescaled = extractSalesOrderForecastInstallments(
    {
      parcelas: [
        { numeroParcela: 1, dataVencimento: "20/10/2026", valor: 175.6 },
      ],
    },
    175_600,
    new Date("2026-07-14")
  );
  if (
    rescaled.length === 1 &&
    Math.abs((rescaled[0]?.expectedAmount ?? 0) - 175_600) < 0.01
  ) {
    ok(
      "runtime:pd02740:rescale",
      "parcela 1000× menor é reescalada para R$ 175.600 (batida com totalNetValue)"
    );
  } else {
    fail(
      "runtime:pd02740:rescale",
      `esperado 175600, veio ${rescaled[0]?.expectedAmount}`
    );
  }

  // Parseamento de string pt-BR "175.600,00" → 175600.
  const parsedBrString = extractSalesOrderForecastInstallments(
    {
      parcelas: [
        { numeroParcela: 1, dataVencimento: "20/10/2026", valor: "175.600,00" },
      ],
    },
    175_600,
    new Date("2026-07-14")
  );
  if (
    parsedBrString.length === 1 &&
    parsedBrString[0]?.expectedAmount === 175_600
  ) {
    ok(
      "runtime:pd02740:pt-br-string",
      "toNumber trata '175.600,00' como 175600 (não 0 nem 175.6)"
    );
  } else {
    fail(
      "runtime:pd02740:pt-br-string",
      `esperado 175600, veio ${parsedBrString[0]?.expectedAmount}`
    );
  }

  // Parcelas com escala correta continuam sendo preservadas.
  const preserved = extractSalesOrderForecastInstallments(
    {
      parcelas: [
        { numeroParcela: 1, dataVencimento: "08/08/2026", valor: 10_000 },
        { numeroParcela: 2, dataVencimento: "08/09/2026", valor: 10_000 },
      ],
    },
    20_000,
    new Date("2026-07-14")
  );
  if (
    preserved.length === 2 &&
    preserved[0]?.expectedAmount === 10_000 &&
    preserved[1]?.expectedAmount === 10_000
  ) {
    ok(
      "runtime:scale:preserve-correct",
      "parcelas com escala correta são preservadas (não reescala falsamente)"
    );
  } else {
    fail(
      "runtime:scale:preserve-correct",
      `esperado 10000+10000, veio ${preserved.map((p) => p.expectedAmount).join(",")}`
    );
  }
}

// ---------------------------------------------------------------------------
// 10) NF-e cancelada — status oficial + UI + alertas (PD 02586)
// ---------------------------------------------------------------------------
function checkCanceledNfeRules() {
  for (const rel of [
    "src/lib/finance/nfeStatus.ts",
    "docs/finance/nfe-status-rules.md",
    "tmp-audits/inspect-nfe-status-pd02586.ts",
    "tmp-audits/inspect-order-full-audit-pd02586.ts",
  ]) {
    if (exists(rel)) ok(`nfe-cancel:file:${rel}`, "presente");
    else fail(`nfe-cancel:file:${rel}`, "ausente");
  }

  const nfeStatus = read("src/lib/finance/nfeStatus.ts");
  for (const marker of [
    "normalizeNfeStatus",
    "isNomusNfeCancelled",
    "isValidForBilling",
    "CANCELED",
    "AUTHORIZED",
  ]) {
    if (nfeStatus.includes(marker)) ok(`nfe-cancel:helper:${marker}`, "presente");
    else fail(`nfe-cancel:helper:${marker}`, `marker ${marker} ausente`);
  }

  const svc = read("src/lib/finance/orderFullAuditService.ts");
  for (const marker of [
    "nfeValidValue",
    "nfeCanceledValue",
    "isCanceled",
    "isValidForBilling",
    "NFE_CANCELED_LINKED_TO_ORDER",
    "CANCELED_NFE_WITH_RECEIVABLE",
    "DOCUMENT_LINKED_TO_CANCELED_NFE",
    "NFE_STATUS_UNKNOWN",
    "nfeStatus.js",
  ]) {
    if (svc.includes(marker)) ok(`nfe-cancel:svc:${marker}`, "presente");
    else fail(`nfe-cancel:svc:${marker}`, `marker ${marker} ausente no service`);
  }

  const dlg = read("src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx");
  for (const marker of [
    "Cancelada",
    "NfeStatusBadge",
    "NFE_CANCELED_LINKED_TO_ORDER",
    "Não compõe faturamento válido",
  ]) {
    if (dlg.includes(marker)) ok(`nfe-cancel:ui:${marker}`, "presente");
    else fail(`nfe-cancel:ui:${marker}`, `marker ${marker} ausente na UI`);
  }

  const o2c = read("src/lib/sales/orderToCashAuditBuilder.ts");
  if (o2c.includes("isNomusNfeCancelled") && o2c.includes("NFE_CANCELED_LINKED_TO_ORDER")) {
    ok("nfe-cancel:o2c", "Order-to-Cash detecta cancelamento via status oficial");
  } else {
    fail("nfe-cancel:o2c", "Order-to-Cash sem detecção oficial de NF cancelada");
  }

  const statusTab = read("src/lib/finance/portfolioOrderStatusService.ts");
  const statusUi = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusPedidosTable.tsx"
  );
  if (
    statusTab.includes("hasCanceledInvoice") &&
    statusUi.includes("NF cancelada")
  ) {
    ok("nfe-cancel:status-pedidos", "Status Pedidos expõe chip NF cancelada");
  } else {
    fail("nfe-cancel:status-pedidos", "Status Pedidos sem chip/campo de NF cancelada");
  }

  // Frontend não importa Prisma (já coberto; reforço do dialog + client).
  const client = read("src/lib/finance/orderFullAuditClient.ts");
  if (/@prisma\/client/.test(client) || /from ["'].*prisma/.test(dlg)) {
    fail("nfe-cancel:frontend-no-prisma", "frontend/client importa Prisma");
  } else {
    ok("nfe-cancel:frontend-no-prisma", "frontend não importa Prisma");
  }
}

async function checkCanceledNfeNormalizeRuntime() {
  const {
    normalizeNfeStatus,
    isNomusNfeCancelled,
  } = await import("../src/lib/finance/nfeStatus.js");

  const canceled = normalizeNfeStatus({ status: 7 });
  if (
    canceled.isCanceled &&
    !canceled.isValidForBilling &&
    canceled.statusNormalized === "CANCELED"
  ) {
    ok("nfe-cancel:runtime:7135-like", "status 7 → CANCELED / não faturável");
  } else {
    fail("nfe-cancel:runtime:7135-like", JSON.stringify(canceled));
  }

  const authorized = normalizeNfeStatus({ status: 4 });
  if (
    !authorized.isCanceled &&
    authorized.isValidForBilling &&
    authorized.statusNormalized === "AUTHORIZED"
  ) {
    ok("nfe-cancel:runtime:7142-like", "status 4 → AUTHORIZED / faturável");
  } else {
    fail("nfe-cancel:runtime:7142-like", JSON.stringify(authorized));
  }

  if (isNomusNfeCancelled(7) && !isNomusNfeCancelled(4)) {
    ok("nfe-cancel:runtime:isCancelled", "isNomusNfeCancelled distingue 7 vs 4");
  } else {
    fail("nfe-cancel:runtime:isCancelled", "falha na distinção 7 vs 4");
  }
}

async function main() {
  console.log("=== qaOrderFullAuditOfficialEngines (static + fixture) ===\n");
  checkFilesPresent();
  checkOrderReceivablesResolver();
  checkOfficialEnginesInService();
  checkClientContract();
  checkFinancialTabUI();
  checkPlannedAlertCodes();
  checkCommercialResponsibleGuard();
  checkFrontendNoPrisma();
  checkCanceledNfeRules();
  await checkRuntimeFixture();
  await checkCanceledNfeNormalizeRuntime();

  console.log("");
  if (failed === 0) {
    console.log("✔ Todos os invariantes de motores oficiais passaram.");
  } else {
    console.error(`✗ ${failed} check(s) falharam.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

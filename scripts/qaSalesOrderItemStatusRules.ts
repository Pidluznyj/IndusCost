/**
 * QA estático — regras de status do item do Pedido de Venda (cancelado/stale).
 * Uso: npx tsx scripts/qaSalesOrderItemStatusRules.ts
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
  console.log(`OK  ${id} — ${msg}`);
}

function fail(id: string, msg: string) {
  failed += 1;
  console.error(`FAIL ${id} — ${msg}`);
}

function main() {
  console.log("=== qaSalesOrderItemStatusRules (static) ===\n");

  if (exists("docs/sales/sales-order-item-status-rules.md")) {
    ok("docs:rules", "regras oficiais");
  } else fail("docs:rules", "docs/sales/sales-order-item-status-rules.md ausente");

  if (exists("docs/sales/sales-order-item-status-impact-audit.md")) {
    ok("docs:audit", "inventário de impacto");
  } else fail("docs:audit", "impact-audit ausente");

  const schema = read("prisma/schema.prisma");
  for (const field of [
    "nomusIsCanceled",
    "nomusIsStale",
    "nomusItemStatusNormalized",
    "nomusRawItem",
  ]) {
    if (schema.includes(field)) ok(`schema:${field}`, field);
    else fail(`schema:${field}`, `${field} ausente`);
  }

  const normalizer = read("src/lib/sales/nomusSalesOrderItemStatus.ts");
  for (const fn of [
    "normalizeNomusSalesOrderItemStatus",
    "isNomusSalesOrderItemCanceled",
    "isSalesOrderItemActiveForCommercialValue",
    "isSalesOrderItemActiveForReceivableForecast",
    "isSalesOrderItemActiveForCommission",
    "isSalesOrderItemActiveForMargin",
    "isFulfilledWithCutSalesOrderItem",
    "resolveNomusRawItemMatchesForOrder",
    "resolveNomusRawItemForSalesOrderItem",
    "IGNORED_CANCELED_ITEM",
    "IGNORED_STALE_ITEM",
    "IGNORED_CUT_ITEM",
    "FULFILLED_WITH_CUT",
    "RELEASED",
  ]) {
    if (normalizer.includes(fn)) ok(`norm:${fn}`, fn);
    else fail(`norm:${fn}`, `${fn} ausente`);
  }

  for (const field of [
    "nomusIsCut",
    "nomusMatchConfidence",
    "nomusMatchReason",
  ]) {
    if (schema.includes(field)) ok(`schema:${field}`, field);
    else fail(`schema:${field}`, `${field} ausente no schema`);
  }

  const builder = read("src/lib/sales/orderToCashAuditBuilder.ts");
  if (builder.includes("ORDER_ITEM_CANCELED")) ok("o2c:lineType", "ORDER_ITEM_CANCELED");
  else fail("o2c:lineType", "ORDER_ITEM_CANCELED ausente");
  if (builder.includes("ORDER_ITEM_CUT")) ok("o2c:lineTypeCut", "ORDER_ITEM_CUT");
  else fail("o2c:lineTypeCut", "ORDER_ITEM_CUT ausente");
  if (builder.includes("isInactiveOrderToCashOrderItem")) {
    ok("o2c:inactive", "filtro inativo no builder");
  } else fail("o2c:inactive", "filtro inativo ausente");
  if (builder.includes("plannedBaseValue")) {
    ok("o2c:plannedActive", "parcelas no valor ativo");
  } else fail("o2c:plannedActive", "plannedBaseValue ausente");

  const statusSvc = read("src/lib/finance/portfolioOrderStatusService.ts");
  if (statusSvc.includes("ORDER_ITEM_CANCELED")) {
    ok("status:canceledLine", "Status Pedidos trata ORDER_ITEM_CANCELED");
  } else fail("status:canceledLine", "ORDER_ITEM_CANCELED não referenciado");

  const commission = read("src/lib/commissions/commission-source-resolver.server.ts");
  if (commission.includes("resolveCommissionIgnoreReasonForSalesOrderItem")) {
    ok("commission:ignore", "resolver ignora cancelado/stale");
  } else fail("commission:ignore", "ignore reason ausente no resolver");

  const crm = read("src/lib/crmCustomersList.ts");
  if (crm.includes('nomusIsCanceled" = false') || crm.includes("nomusIsCanceled")) {
    ok("crm:leading", "CRM leading exclui cancelados");
  } else fail("crm:leading", "CRM sem filtro de cancelado");

  const evidence = read("docs/finance/order-to-cash-audit-item-evidence-rules.md");
  if (evidence.includes("ORDER_ITEM_CANCELED")) {
    ok("docs:evidence", "evidência documenta ORDER_ITEM_CANCELED");
  } else fail("docs:evidence", "doc evidência sem ORDER_ITEM_CANCELED");

  // Frontend sem Prisma
  const clientFiles = [
    "src/lib/finance/portfolioOrderStatusClient.ts",
    "src/lib/finance/orderToCashAuditItemsUi.ts",
  ];
  for (const f of clientFiles) {
    if (!exists(f)) continue;
    const body = read(f);
    if (/\bprisma\b/i.test(body) && !body.includes("// prisma")) {
      fail(`frontend:${f}`, "possível uso de prisma no client");
    } else ok(`frontend:${f}`, "sem Prisma");
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${failed} falha(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

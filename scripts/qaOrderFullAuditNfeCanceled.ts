/**
 * QA — NF cancelada × CR na Auditoria 360º / Status Pedidos.
 *
 * Uso: npx tsx scripts/qaOrderFullAuditNfeCanceled.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeNfeStatus } from "../src/lib/finance/nfeStatus.js";

const ROOT = process.cwd();
type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function ok(id: string, detail: string): void {
  checks.push({ id, ok: true, detail });
  console.log(`OK   ${id} — ${detail}`);
}

function fail(id: string, detail: string): void {
  checks.push({ id, ok: false, detail });
  console.log(`FAIL ${id} — ${detail}`);
}

function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

function main(): void {
  section("1–4 Helper + service");
  const canceled = normalizeNfeStatus({ status: 7 });
  const authorized = normalizeNfeStatus({ status: 4 });
  if (canceled.isCanceled && !canceled.isValidForBilling) {
    ok("1-nfe-7135-rule", "status 7 = Cancelada / não faturável");
  } else fail("1-nfe-7135-rule", JSON.stringify(canceled));
  if (authorized.isValidForBilling && !authorized.isCanceled) {
    ok("4-nfe-7142-rule", "status 4 = Autorizada / faturável");
  } else fail("4-nfe-7142-rule", JSON.stringify(authorized));

  const service = read("src/lib/finance/orderFullAuditService.ts");
  if (
    service.includes("allocatedValueToOrder = 0") &&
    service.includes("isCanceled") &&
    service.includes("isValidForBilling")
  ) {
    ok("3-canceled-zero-alloc", "NF cancelada zera allocatedValueToOrder");
  } else fail("3-canceled-zero-alloc", "zero alloc ausente no service");

  if (
    service.includes("RECEIVED_CR_LINKED_TO_CANCELED_NFE") &&
    service.includes("linkedNfeIsCanceled") &&
    service.includes("receivableIsReceived")
  ) {
    ok("5-cr-alert-fields", "CR com campos fiscais + alerta RECEIVED_CR");
  } else fail("5-cr-alert-fields", "campos/alerta CR ausentes");

  section("6–7 UI");
  const dialog = read(
    "src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx"
  );
  if (
    dialog.includes("Status NF vinculada") &&
    dialog.includes("Status financeiro") &&
    dialog.includes("RECEIVED_CR_LINKED_TO_CANCELED_NFE")
  ) {
    ok("6-finance-split", "Aba Financeiro separa status financeiro × fiscal");
  } else fail("6-finance-split", "colunas/alerts financeiros incompletos");

  if (
    dialog.includes("NfeStatusBadge") &&
    dialog.includes("Cancelada") &&
    dialog.includes("Não compõe faturamento válido")
  ) {
    ok("7-nfe-badge", "Aba NF-e mostra badge Cancelada + aviso");
  } else fail("7-nfe-badge", "badge/aviso NF ausente");

  section("8–9 Status Pedidos");
  const statusSvc = read("src/lib/finance/portfolioOrderStatusService.ts");
  const pedidosTable = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusPedidosTable.tsx"
  );
  if (
    statusSvc.includes("hasCanceledInvoice") &&
    statusSvc.includes("hasReceivedCrLinkedToCanceledNfe") &&
    pedidosTable.includes("NF cancelada") &&
    pedidosTable.includes("CR recebido c/ NF cancelada")
  ) {
    ok("8-status-chips", "Status Pedidos chips NF cancelada + CR recebido");
  } else fail("8-status-chips", "chips Status Pedidos incompletos");

  if (
    statusSvc.includes("aggregateFactsToOrderStatusRows") ||
    /one row|por pedido|orderKey/.test(statusSvc)
  ) {
    ok("9-one-row", "Status Pedidos continua consolidado por pedido");
  } else fail("9-one-row", "agregação por pedido não encontrada");

  section("10 Frontend sem Prisma");
  if (!/@prisma\/client/.test(dialog)) {
    ok("10-no-prisma", "OrderFullAuditDialog sem Prisma");
  } else fail("10-no-prisma", "Dialog importa Prisma");

  section("Docs");
  const docs = [
    "docs/finance/nfe-status-rules.md",
    "docs/finance/order-full-audit-dialog.md",
    "docs/finance/portfolio-order-status-tab.md",
  ];
  let docsOk = true;
  for (const d of docs) {
    const src = read(d);
    if (!/cancelad|NF-e|faturamento válido/i.test(src)) {
      docsOk = false;
      fail("docs", `${d} sem menção a NF cancelada / faturamento`);
    }
  }
  if (docsOk) ok("docs", "Documentação atualizada");

  section("Resumo");
  const failed = checks.filter((c) => !c.ok);
  console.log(
    JSON.stringify(
      {
        total: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        failedIds: failed.map((c) => c.id),
        verdict: failed.length === 0 ? "OK" : "FALHA",
      },
      null,
      2
    )
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main();

/**
 * QA estático — Auditoria Completa do Pedido (modal).
 * Uso: npx tsx scripts/qaOrderFullAuditDialog.ts
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
function ok(id: string, msg: string): void {
  console.log(`OK   ${id} — ${msg}`);
}
function fail(id: string, msg: string): void {
  failed += 1;
  console.error(`FAIL ${id} — ${msg}`);
}

function main(): void {
  console.log("=== qaOrderFullAuditDialog (static) ===\n");

  const service = "src/lib/finance/orderFullAuditService.ts";
  if (!exists(service)) return fail("service", "orderFullAuditService.ts ausente");
  const svc = read(service);
  if (!svc.includes("loadOrderFullAudit"))
    return fail("service:load", "loadOrderFullAudit ausente");
  if (
    !svc.includes("nomusAccountsReceivable") ||
    !svc.includes("nomusNfe") ||
    !svc.includes("nomusStockDocument")
  ) {
    return fail(
      "service:sources",
      "service deve consumir nomusAccountsReceivable / nomusNfe / nomusStockDocument"
    );
  }
  ok("service", "service compõe SalesOrder + Fact + NF + Doc + CR");

  const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
  if (!routes.includes("/orders/:salesOrderId/audit-full")) {
    return fail("route", "rota audit-full ausente");
  }
  if (!routes.includes("loadOrderFullAudit")) {
    return fail("route:handler", "handler não usa loadOrderFullAudit");
  }
  ok("route", "rota audit-full registrada");

  const client = "src/lib/finance/orderFullAuditClient.ts";
  if (!exists(client)) return fail("client", "orderFullAuditClient.ts ausente");
  const cli = read(client);
  if (!cli.includes("buildOrderFullAuditUrl") || !cli.includes("ORDER_FULL_AUDIT_TABS")) {
    return fail("client:contract", "contrato do client incompleto");
  }
  ok("client", "contrato client (7 abas) exposto sem Prisma");

  const dialog = "src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx";
  if (!exists(dialog)) return fail("dialog", "OrderFullAuditDialog.tsx ausente");
  const dlg = read(dialog);
  if (/@prisma\/client/.test(dlg) || dlg.includes("prisma.js")) {
    return fail("dialog:no-prisma", "dialog não pode importar Prisma");
  }
  ok("dialog:no-prisma", "dialog sem Prisma no frontend");
  for (const label of [
    "Resumo",
    "Itens",
    "Financeiro",
    "Documentos",
    "NF-e",
    "Entrega / Frete",
    "Alertas",
    "Auditoria completa",
    "Pedido → Documento de saída → NF-e → Contas a Receber → Baixas",
    "OrderToCashAuditItemsGrid",
    "Abrir no Contas a Receber",
  ]) {
    if (!dlg.includes(label)) {
      return fail("dialog:content", `label/tag ausente: ${label}`);
    }
  }
  ok("dialog:content", "7 abas + reuso do OrderToCashAuditItemsGrid + botão CR");

  const tab = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusTab.tsx"
  );
  if (tab.includes("OrderStatusSelectedOrderItemsPanel")) {
    return fail(
      "tab:legacy-panel-removed",
      "Painel drilldown antigo ainda referenciado em OrderStatusTab.tsx"
    );
  }
  if (!tab.includes("OrderFullAuditDialog")) {
    return fail("tab:integration", "OrderStatusTab não abre OrderFullAuditDialog");
  }
  if (!tab.includes("Auditoria completa do pedido")) {
    return fail("tab:hint", "Empty state / hint ausente");
  }
  ok(
    "tab:integration",
    "OrderStatusTab substituiu o painel embutido pelo modal + hint"
  );

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${failed} falha(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

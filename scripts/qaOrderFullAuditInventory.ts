/**
 * QA estático — inventário técnico + contrato da Auditoria 360º do Pedido.
 * Uso: npx tsx scripts/qaOrderFullAuditInventory.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let failed = 0;
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const exists = (rel: string): boolean => existsSync(join(root, rel));
const ok = (id: string, msg: string): void => {
  console.log(`OK   ${id} — ${msg}`);
};
const fail = (id: string, msg: string): void => {
  failed += 1;
  console.error(`FAIL ${id} — ${msg}`);
};

const REQUIRED_INVENTORY_SECTIONS = [
  "SalesOrder",
  "SalesOrderItem",
  "SalesOrderNfeLink",
  "Proposal",
  "OrderToCashAuditFact",
  "NomusStockDocument",
  "NomusNfe",
  "NomusAccountsReceivable",
  "PriceTable",
  "ProductionCostTable",
  "CommissionOrderSnapshot",
  "CrmCustomerCommercialOwner",
];

// Blocos do payload (nomes reais no service). No contrato do inventário
// `orderItems` é o alias conceitual do array `items` (linha do pedido).
const REQUIRED_BLOCKS = [
  "summary",
  "proposal",
  "salesOrder",
  "items",
  "stockDocuments",
  "nfes",
  "receivables",
  "receipts",
  "delivery",
  "freight",
  "marginPricing",
  "commissions",
  "divergences",
  "technicalAudit",
];

function main(): void {
  console.log("=== qaOrderFullAuditInventory (static) ===\n");

  // 1. Documento de inventário
  const invPath = "docs/finance/order-full-audit-inventory.md";
  if (!exists(invPath)) return fail("docs:inventory", `${invPath} ausente`);
  const inv = read(invPath);
  for (const section of REQUIRED_INVENTORY_SECTIONS) {
    if (!inv.includes(section)) {
      return fail("docs:inventory-section", `Faltando seção/model: ${section}`);
    }
  }
  ok("docs:inventory", "inventário cobre 12 models/serviços exigidos");

  // 2. Service estende contrato com stubs tipados dos 12 blocos.
  const svc = read("src/lib/finance/orderFullAuditService.ts");
  for (const block of REQUIRED_BLOCKS) {
    if (!svc.includes(block)) {
      return fail("service:block", `Bloco ${block} ausente no payload`);
    }
  }
  ok("service:contract", "OrderFullAuditPayload exporta os 12 blocos previstos");

  for (const stub of [
    "OrderFullAuditProposalBlock",
    "OrderFullAuditSalesOrderBlock",
    "OrderFullAuditReceipt",
    "OrderFullAuditFreightBlock",
    "OrderFullAuditMarginPricingBlock",
    "OrderFullAuditCommissionBlock",
    "OrderFullAuditDivergenceBlock",
    "OrderFullAuditTechnicalAuditBlock",
  ]) {
    if (!svc.includes(stub)) {
      return fail("service:stub-type", `type ${stub} ausente`);
    }
  }
  ok("service:stub-types", "types dos blocos futuros exportados");

  // 3. Assinatura: includeRaw / orderCode / runId
  for (const arg of ["runId?:", "orderCode?:", "includeRaw?:"]) {
    if (!svc.includes(arg)) {
      return fail(
        "service:signature",
        `LoadOrderFullAuditInput deve aceitar ${arg}`
      );
    }
  }
  ok(
    "service:signature",
    "loadOrderFullAudit aceita runId + orderCode + includeRaw"
  );

  // 4. Rota registrada e propaga os 3 parâmetros.
  const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
  if (!routes.includes("/orders/:salesOrderId/audit-full")) {
    return fail("route", "rota audit-full ausente");
  }
  if (
    !routes.includes("loadOrderFullAudit") ||
    !routes.includes("includeRaw") ||
    !routes.includes("orderCode")
  ) {
    return fail(
      "route:params",
      "rota deve propagar runId + orderCode + includeRaw"
    );
  }
  ok("route", "rota audit-full propaga runId / orderCode / includeRaw");

  // 5. Client mantido em sync com contrato (evita divergência silenciosa).
  const client = read("src/lib/finance/orderFullAuditClient.ts");
  if (!client.includes("OrderFullAuditPayload")) {
    return fail("client:contract", "client sem type OrderFullAuditPayload");
  }
  if (client.includes("prisma") || client.includes("@prisma/client")) {
    return fail("client:no-prisma", "client não pode importar Prisma");
  }
  ok("client:no-prisma", "client sem Prisma");

  // 6. Inspect script existe.
  if (!exists("tmp-audits/inspect-order-full-audit-sources.ts")) {
    return fail("inspect", "inspect-order-full-audit-sources.ts ausente");
  }
  ok("inspect", "inspect de fontes criado");

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${failed} falha(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

/**
 * QA estático + unitário das regras Responsável carteira × Vendedor pedido.
 * Usage: npx tsx scripts/qaCrmCommercialOwnerAndSellerRules.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_ASSIGN_SOURCE,
  isMappableOrderSeller,
} from "../src/lib/commercial/crmCommercialOwnerAutoAssign.ts";
import { isForbiddenCommercialResponsibleName } from "../src/lib/commercial/crmCommercialResponsibleResolver.ts";

function ok(label: string) {
  console.log(`OK  ${label}`);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const root = process.cwd();
const sellerDash = readFileSync(join(root, "src/lib/crmSellerDashboardService.ts"), "utf8");
const sync = readFileSync(join(root, "scripts/nomusSalesOrdersSyncV1.ts"), "utf8");
const server = readFileSync(join(root, "server.ts"), "utf8");
const modal = readFileSync(join(root, "src/components/CrmSellerDashboardSection.tsx"), "utf8");
const autoAssign = readFileSync(
  join(root, "src/lib/commercial/crmCommercialOwnerAutoAssign.ts"),
  "utf8"
);
const docs = readFileSync(
  join(root, "docs/commercial/crm-commercial-owner-and-order-seller-rules.md"),
  "utf8"
);

section("1. Filtro Vendedor do pedido usa SalesOrder");
assert.match(sellerDash, /orderSellerOptions/);
assert.match(sellerDash, /buildCrmSellerFilterSql/);
assert.match(sellerDash, /nomusSellerName/);
assert.match(server, /orderSellerIdentityKey/);
ok("seller-dashboard + API aceitam order seller");

section("2. Filtro Responsável da carteira");
assert.match(sellerDash, /CrmCustomerCommercialOwner/);
assert.match(sellerDash, /buildCrmCommercialOwnerOnlyOrderScopeSql/);
assert.match(modal, /Responsável da carteira/);
ok("owner-only scope + label carteira");

section("3. UI dual filter");
assert.match(modal, /Vendedor do pedido/);
assert.match(modal, /onOrderSellerChange/);
ok("UI com dois filtros");

section("4–5. Autoatribuição e não substituição");
assert.match(autoAssign, /AUTO_FROM_SALES_ORDER_SELLER/);
assert.match(autoAssign, /SKIP_AUTO_ASSIGN_ALREADY_OWNED|skipped_owned/);
assert.match(sync, /autoAssignCommercialOwnersAfterNomusSync/);
assert.equal(AUTO_ASSIGN_SOURCE, "AUTO_FROM_SALES_ORDER_SELLER");
assert.equal(
  isMappableOrderSeller({
    nomusSellerName: "Gislene Lima",
    responsible: null,
    externalSellerId: 464,
  }),
  true
);
assert.equal(
  isMappableOrderSeller({
    nomusSellerName: "FINANCEIRO",
    responsible: null,
    externalSellerId: null,
  }),
  false
);
assert.equal(isForbiddenCommercialResponsibleName("FINANCEIRO"), true);
ok("auto-assign + guards");

section("6–7. Backfill preview/apply");
const backfill = readFileSync(
  join(root, "scripts/backfillCrmCommercialOwnerFromSalesOrderSeller.ts"),
  "utf8"
);
assert.match(backfill, /preview/);
assert.match(backfill, /apply/);
assert.match(backfill, /applyCommercialOwnerAutoAssignFromOrders/);
ok("backfill script");

section("8–9. Comissão usa vendedor do pedido");
assert.match(docs, /comissão|Comissão/i);
assert.match(docs, /comissionável/i);
ok("docs: comissão ≠ responsável");

section("10. Propostas não oficiais");
assert.match(docs, /Propostas/);
ok("docs propostas");

section("11. Escopo");
assert.match(docs, /SELLER/);
assert.match(sellerDash, /sellerScopeMode === "own"|scopeMode === "own"/);
ok("escopo documentado e enforced");

section("12–13. Frontend sem Prisma");
assert.doesNotMatch(modal, /@prisma\/client|from ["']@\/src\/lib\/prisma/);
const crmModule = readFileSync(join(root, "src/components/CrmModule.tsx"), "utf8");
assert.doesNotMatch(crmModule, /@prisma\/client|from ["']@\/src\/lib\/prisma/);
ok("frontend sem Prisma");

console.log("\nQA crm commercial owner/seller rules: PASS\n");

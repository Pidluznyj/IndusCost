/**
 * QA: CRM nunca exibe "Vendedor ID N" como label executivo.
 * Usage: npx tsx scripts/qaCrmCommercialPersonDisplayNames.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  consolidateSellerRowFragments,
} from "../src/lib/crmSellerIdentityConsolidation.ts";
import {
  isSellerIdOnlyLabel,
  resolveCommercialOwnerDisplay,
  resolveCommercialPersonDisplay,
  ORDER_SELLER_UNMAPPED_LABEL,
} from "../src/lib/commercial/commercialPersonIdentityResolver.ts";

function ok(label: string) {
  console.log(`OK  ${label}`);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

section("1. Gestão por Responsável — serviço usa enrich compartilhado");
const sellerDash = read("src/lib/crmSellerDashboardService.ts");
assert.match(sellerDash, /enrichOrderSellerOptionRowsWithNames/);
assert.match(sellerDash, /commercialOwnerOptionRows/);
assert.match(sellerDash, /orderSellerOptions/);
assert.match(sellerDash, /CrmCustomerCommercialOwner/);
ok("seller-dashboard carrega owners + order sellers com enrich");

section("2. Vendedor do Pedido — nomes canônicos (consolidação)");
{
  const options = consolidateSellerRowFragments([
    { external_seller_id: 464, responsible: "GISLENE LIMA", orders_count: 5 },
    { external_seller_id: 1399, responsible: "Rodrigo Da Silva Ramos", orders_count: 3 },
  ]);
  const labels = options.map((o) => o.displayName);
  assert.ok(labels.includes("GISLENE LIMA"));
  assert.ok(labels.includes("Rodrigo Da Silva Ramos"));
  assert.equal(labels.some((n) => isSellerIdOnlyLabel(n)), false);
  ok("filtro Vendedor do Pedido continua canônico");
}

section("3–5. Responsável da Carteira — sem Vendedor ID; resolve 1399/464");
{
  const options = consolidateSellerRowFragments([
    { external_seller_id: 1399, responsible: "Vendedor ID 1399", orders_count: 2 },
    {
      external_seller_id: 1399,
      responsible: "Rodrigo Da Silva Ramos",
      orders_count: 4,
    },
    { external_seller_id: 464, responsible: "Vendedor ID 464", orders_count: 1 },
    { external_seller_id: 464, responsible: "GISLENE LIMA", orders_count: 9 },
    { external_seller_id: 1189, responsible: "Vendedor ID 1189", orders_count: 2 },
  ]);
  const labels = options.map((o) => o.displayName);
  assert.equal(labels.some((n) => isSellerIdOnlyLabel(n)), false);
  assert.ok(labels.includes("Rodrigo Da Silva Ramos"));
  assert.ok(labels.includes("GISLENE LIMA"));
  assert.ok(labels.includes(ORDER_SELLER_UNMAPPED_LABEL));
  const rodrigo = options.find((o) => o.displayName === "Rodrigo Da Silva Ramos");
  assert.ok(rodrigo?.externalSellerIds.includes(1399));
  const gislene = options.find((o) => o.displayName === "GISLENE LIMA");
  assert.ok(gislene?.externalSellerIds.includes(464));
  ok("Responsável da Carteira resolve IDs e agrupa canônicos");
}

section("6–7. Carteira / Gestão Geral — display sanitizado");
{
  const list = read("src/lib/crmCustomersList.ts");
  const metrics = read("src/lib/commercial/crmSalesOrderMetricsService.ts");
  const owner = read("src/lib/crmCustomerCommercialOwner.ts");
  assert.match(list, /resolveCommercialOwnerDisplay/);
  assert.match(metrics, /resolveCommercialOwnerDisplay/);
  assert.match(owner, /enrichResolvedCommercialOwnerNames|enrichOrderSellerOptionRowsWithNames/);
  assert.doesNotMatch(owner, /`Vendedor ID \$\{/);
  assert.doesNotMatch(owner, /"Vendedor ID \$\{/);
  ok("lista + métricas usam display resolvido; inferência sem template Vendedor ID");
}

section("8. IDs em auditoria técnica");
{
  const consol = read("src/lib/crmSellerIdentityConsolidation.ts");
  assert.match(consol, /formatConsolidatedSellerAuditLabel/);
  assert.match(consol, /IDs Nomus/);
  ok("IDs Nomus permanecem no label de auditoria");
}

section("9. Conceitos separados");
{
  const modal = read("src/components/CrmSellerDashboardSection.tsx");
  assert.match(modal, /Responsável da carteira/);
  assert.match(modal, /Vendedor do pedido/);
  assert.match(sellerDash, /soOwnerScope/);
  assert.match(sellerDash, /soOrderSellerScope/);
  ok("carteira × pedido separados nos filtros");
}

section("10. Permissões (escopo own)");
{
  assert.match(sellerDash, /sellerScopeMode === "own"/);
  assert.match(sellerDash, /emptyMetricsPayload/);
  assert.match(sellerDash, /consolidatedIdentityMatchesUser|linkedUser/);
  ok("escopo own / carteira preservado");
}

section("11. Frontend sem Prisma");
{
  const crmModule = read("src/components/CrmModule.tsx");
  assert.doesNotMatch(crmModule, /from ["']@prisma\/client["']/);
  assert.doesNotMatch(crmModule, /PrismaClient/);
  ok("CrmModule sem Prisma");
}

section("12. Resolver compartilhado");
{
  const resolver = read("src/lib/commercial/commercialPersonIdentityResolver.ts");
  assert.match(resolver, /resolveCommercialPersonDisplay/);
  assert.match(resolver, /resolveCommercialOwnerDisplay/);
  assert.match(resolver, /resolveOrderSellerDisplay/);
  assert.equal(isSellerIdOnlyLabel("Vendedor ID 1399"), true);
  assert.equal(
    resolveCommercialPersonDisplay({
      rawId: 1399,
      rawName: "Vendedor ID 1399",
    }).displayName,
    ORDER_SELLER_UNMAPPED_LABEL
  );
  assert.equal(
    resolveCommercialOwnerDisplay({
      rawId: 1399,
      canonicalName: "Rodrigo Da Silva Ramos",
    }).displayName,
    "Rodrigo Da Silva Ramos"
  );
  ok("commercialPersonIdentityResolver ativo");
}

console.log("\n✅ qaCrmCommercialPersonDisplayNames OK");

/**
 * QA estático — aba Fechamentos por vendedor (ledger oficial).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}
function ok(msg: string) {
  console.log(`OK  ${msg}`);
}

section("1. Navegação e aba Fechamentos");
{
  const nav = read("src/lib/commissionsNavigation.ts");
  const mod = read("src/components/CommissionsModule.tsx");
  assert.match(nav, /closings/);
  assert.match(nav, /\/commissions\/fechamentos/);
  assert.match(mod, /CommissionsClosingsPage/);
  assert.match(mod, /path=\"fechamentos\"/);
  ok("Aba Fechamentos na navegação e no módulo");
}

section("2–6. Página + relatório por vendedor");
{
  const page = read("src/components/commissions/pages/CommissionsClosingsPage.tsx");
  assert.match(page, /Fechamentos de Comissão/);
  assert.match(page, /\/api\/commissions\/closings/);
  assert.match(page, /Ver relatório/);
  assert.match(page, /commissions-closings-seller-grid/);
  assert.match(page, /createPortal/);
  assert.match(page, /CommissionClosingSellerReportPrintDocument/);
  assert.match(page, /Copiar resumo/);
  ok("Lista, detalhe, grid e PDF portalizados");
}

section("7–10. PDF/XLSX e endpoints");
{
  const routes = read("src/lib/commissionsRoutes.ts");
  const print = read(
    "src/components/commissions/CommissionClosingSellerReportPrintDocument.tsx"
  );
  const shared = read("src/lib/commissions/commissionClosings.shared.ts");
  const server = read("src/lib/commissions/commissionClosings.server.ts");
  assert.match(routes, /\/api\/commissions\/closings/);
  assert.match(routes, /closings\/:closingId\/sellers\/:sellerKey\/xlsx/);
  assert.match(shared, /COMERCIAL: RELATÓRIO DE COMISSÕES/);
  assert.match(print, /COMMISSION_CLOSING_SELLER_REPORT_PRINT_TITLE/);
  assert.match(print, /sales-orders-print-root/);
  assert.match(server, /buildCommissionClosingSellerXlsx/);
  assert.match(server, /listCommissionClosings/);
  ok("Endpoints, PDF padrão Pedidos e XLSX por vendedor");
}

section("11–15. Agrupamento canônico e labels");
{
  const shared = read("src/lib/commissions/commissionClosings.shared.ts");
  const labels = read("src/lib/commissions/commissionReceiptLineStatusLabels.ts");
  assert.match(shared, /resolveClosingSellerGroupKey/);
  assert.match(shared, /buildClosingSellerSummaries/);
  assert.match(shared, /isCanonicalSellerDisplayName/);
  assert.match(labels, /Cliente excluído/);
  assert.match(labels, /Comissionável/);
  assert.doesNotMatch(shared, /from \"@prisma\/client\"/);
  const page = read("src/components/commissions/pages/CommissionsClosingsPage.tsx");
  assert.doesNotMatch(page, /from \"@prisma\/client\"/);
  ok("Vendedor canônico, labels amigáveis, sem Prisma no frontend");
}

console.log("\n✅ qaCommissionClosingsBySeller OK\n");

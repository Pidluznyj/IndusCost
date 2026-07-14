/**
 * QA estrutural — Financeiro > Conciliação de Carteira (página shell).
 *
 * Uso:
 *   npx tsx scripts/qaFinancePortfolioReconciliationPage.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function checkPageLoadsStructure(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  if (/export function FinancePortfolioReconciliationPage/.test(page)) {
    ok("1-page-export", "FinancePortfolioReconciliationPage exportada.");
  } else {
    fail("1-page-export", "export da página ausente.");
  }
  if (/data-testid="finance-portfolio-reconciliation-page"/.test(page)) {
    ok("1b-page-testid", "testid da página presente.");
  } else {
    fail("1b-page-testid", "testid finance-portfolio-reconciliation-page ausente.");
  }
}

function checkGlobalFiltersRemoved(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  const offenders: string[] = [];
  if (/FinanceBiFilterPanel/.test(page)) offenders.push("FinanceBiFilterPanel");
  if (/Fonte da previsão/.test(page)) offenders.push("Fonte da previsão");
  if (/Run de conciliação/.test(page)) offenders.push("Run de conciliação");
  if (/Apenas divergências \/ alertas/.test(page))
    offenders.push("Apenas divergências / alertas");
  if (/portfolio-filter-customer/.test(page)) offenders.push("portfolio-filter-customer");
  if (/createDefaultPortfolioReconciliationUiFilters/.test(page))
    offenders.push("createDefaultPortfolioReconciliationUiFilters");
  if (offenders.length === 0) {
    ok("2-3-4-global-filters-gone", "Card global Filtros / Fonte / Run removidos da UI.");
  } else {
    fail("2-3-4-global-filters-gone", `Resíduos: ${offenders.join(", ")}`);
  }
}

function checkTabsPresent(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  if (
    /portfolio-tab-order-status-pedidos/.test(page) &&
    /portfolio-tab-order-to-cash-audit/.test(page) &&
    /<OrderStatusTab\s*\/>/.test(page) &&
    /<OrderToCashAuditTab\s*\/>/.test(page)
  ) {
    ok("5-tabs", "Abas Status Pedidos e Auditoria Pedido → Caixa presentes.");
  } else {
    fail("5-tabs", "Abas visíveis incompletas.");
  }
}

function checkTabFiltersKept(): void {
  const statusTab = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusTab.tsx"
  );
  const statusFilters = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusFilters.tsx"
  );
  const o2cTab = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
  );
  const o2cFilters = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
  );

  if (/OrderStatusFilters/.test(statusTab) && /período|Ano|Cliente/i.test(statusFilters)) {
    ok("6-7-status-filters", "Filtros internos da aba Status Pedidos presentes.");
  } else {
    fail("6-7-status-filters", "OrderStatusFilters ausente ou incompleto.");
  }

  if (/OrderToCashAuditFilters/.test(o2cTab) && o2cFilters.length > 100) {
    ok("8-o2c-filters", "Auditoria Pedido → Caixa mantém filtros próprios.");
  } else {
    fail("8-o2c-filters", "OrderToCashAuditFilters ausente.");
  }
}

function checkHeaderAndRunMeta(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  if (
    /FINANCE_HEADER_ACTION_REFRESH/.test(page) &&
    /portfolio-reconciliation-run-meta/.test(page) &&
    /PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE/.test(page) &&
    /\/api\/finance\/portfolio-reconciliation\/runs/.test(page)
  ) {
    ok("9-header-run", "Atualizar + alerta paralelo + meta da run presentes.");
  } else {
    fail("9-header-run", "Header/run meta incompletos.");
  }
}

function checkFrontendNoPrisma(): void {
  const offenders: string[] = [];
  const roots = [
    "src/components/finance/FinancePortfolioReconciliationPage.tsx",
    "src/components/finance/portfolio-reconciliation",
  ];
  const scanFile = (full: string) => {
    if (!/\.(tsx?|jsx?)$/.test(full)) return;
    const src = readFileSync(full, "utf8");
    if (/from\s+["']@prisma\/client["']/.test(src)) offenders.push(full);
  };
  for (const rel of roots) {
    const full = join(ROOT, rel);
    const st = statSync(full);
    if (st.isFile()) scanFile(full);
    else {
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const p = join(dir, entry);
          if (statSync(p).isDirectory()) walk(p);
          else scanFile(p);
        }
      };
      walk(full);
    }
  }
  if (offenders.length === 0) {
    ok("10-no-prisma", "Frontend da Conciliação não importa Prisma.");
  } else {
    fail("10-no-prisma", `Prisma no frontend: ${offenders.join(", ")}`);
  }
}

function checkDocs(): void {
  const doc = read("docs/finance/portfolio-reconciliation-page.md");
  if (
    /filtro global legado/i.test(doc) &&
    /Status Pedidos/.test(doc) &&
    /Auditoria Pedido → Caixa/.test(doc)
  ) {
    ok("docs-page", "Documentação da página atualizada.");
  } else {
    fail("docs-page", "docs/finance/portfolio-reconciliation-page.md incompleto.");
  }
}

async function main(): Promise<void> {
  section("QA — Conciliação de Carteira (página)");
  checkPageLoadsStructure();
  checkGlobalFiltersRemoved();
  checkTabsPresent();
  checkTabFiltersKept();
  checkHeaderAndRunMeta();
  checkFrontendNoPrisma();
  checkDocs();

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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

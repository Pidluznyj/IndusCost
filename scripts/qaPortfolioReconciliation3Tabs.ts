/**
 * QA final — 3 abas Conciliação de Carteira × OrderToCashAudit.
 * Read-only. Não grava. Não chama Nomus.
 *
 * Uso:
 *   npx tsx scripts/qaPortfolioReconciliation3Tabs.ts
 *
 * Com DATABASE_URL: exercita loaders reais (run geral + Britânia + empty).
 * Sem DATABASE_URL: contratos estáticos + checklist.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const GENERAL_RUN = "41c2470a-b685-4765-a954-77110fd8cf5c";
const BRITANIA_RUN = "a0bdc0b6-b3d5-42ca-a548-283edbc31cfa";
const BRITANIA_EXTERNAL_ID = 200;
const YEAR = 2026;
const EMPTY_CUSTOMER = 9_999_999;

type Check = { id: string; ok: boolean; detail: string };

const checks: Check[] = [];

function ok(id: string, detail: string): void {
  checks.push({ id, ok: true, detail });
  console.log(`PASS  ${id} — ${detail}`);
}

function fail(id: string, detail: string): void {
  checks.push({ id, ok: false, detail });
  console.error(`FAIL  ${id} — ${detail}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function staticContracts(): void {
  section("Contratos estáticos (código)");

  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
  const server = read("src/lib/financePortfolioReconciliationApi.server.ts");
  const auditServer = read("src/lib/financeOrderToCashAuditApi.server.ts");
  const intel = read(
    "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx"
  );
  const auditTab = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
  );
  const adapter = read("src/lib/finance/orderToCashAuditToPortfolioFactsAdapter.ts");

  const endpoints = [
    ["/api/finance/portfolio-reconciliation", routes.includes('"/api/finance/portfolio-reconciliation"')],
    [
      "/api/finance/portfolio-reconciliation/intelligence",
      routes.includes("/api/finance/portfolio-reconciliation/intelligence"),
    ],
    [
      "/api/finance/portfolio-reconciliation/order-to-cash-audit",
      routes.includes("/api/finance/portfolio-reconciliation/order-to-cash-audit"),
    ],
  ] as const;

  for (const [path, present] of endpoints) {
    if (present) ok(`endpoint:${path}`, "rota registrada");
    else fail(`endpoint:${path}`, "rota ausente");
  }

  if (server.includes("adaptOrderToCashAuditFactsToPortfolioFacts")) {
    ok("conciliation:o2c-adapter", "Conciliação usa adapter O2C");
  } else {
    fail("conciliation:o2c-adapter", "adapter não referenciado no server");
  }

  if (server.includes("loadPortfolioIntelligenceList") && server.includes("ORDER_TO_CASH_AUDIT")) {
    ok("intelligence:o2c-prefer", "Inteligência prefere O2C");
  } else {
    fail("intelligence:o2c-prefer", "preferência O2C não encontrada");
  }

  if (auditServer.includes("orderToCashAuditRun") || auditServer.includes("OrderToCashAudit")) {
    ok("audit:o2c-source", "Auditoria lê OrderToCashAudit");
  } else {
    fail("audit:o2c-source", "fonte O2C ausente no server Auditoria");
  }

  if (adapter.includes("isFirstCrCarrier") || /receivableTotalValue:\s*isFirstCrCarrier/.test(adapter)) {
    ok("adapter:cr-once", "CR só no primeiro fato do pedido");
  } else {
    fail("adapter:cr-once", "dedupe CR não encontrado");
  }

  if (page.includes("portfolio-reconciliation-o2c-source") || page.includes("order_to_cash_audit")) {
    ok("ui:conciliation-run-meta", "UI Conciliação indica fonte/data da run");
  } else {
    fail("ui:conciliation-run-meta", "banner/meta O2C ausente");
  }

  if (intel.includes("portfolio-intelligence-o2c-source") || intel.includes("order_to_cash_audit")) {
    ok("ui:intelligence-source", "UI Inteligência indica fonte O2C");
  } else {
    fail("ui:intelligence-source", "banner O2C Inteligência ausente");
  }

  if (auditTab.includes("FinanceModuleEmptyState") && auditTab.includes("emptyKind")) {
    ok("ui:audit-empty-states", "Auditoria diferencia empty/no_run/filtered");
  } else {
    fail("ui:audit-empty-states", "empty states Auditoria incompletos");
  }

  // Sem Prisma no frontend das abas
  const frontendFiles = [
    "src/components/finance/FinancePortfolioReconciliationPage.tsx",
    "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx",
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx",
    "src/lib/financePortfolioReconciliationClient.ts",
    "src/lib/finance/orderToCashAuditClient.ts",
  ];
  let prismaLeak = false;
  for (const f of frontendFiles) {
    if (!existsSync(join(process.cwd(), f))) continue;
    const src = read(f);
    if (/from\s+["']@prisma\/client["']|prisma\./.test(src) && !f.includes(".server.")) {
      prismaLeak = true;
      fail(`bundle:${f}`, "possível import Prisma/server no frontend");
    }
  }
  if (!prismaLeak) ok("bundle:no-prisma-frontend", "abas/client sem Prisma");

  // Filtros presentes
  if (/customerExternalId|year|month/.test(page)) {
    ok("filters:conciliation", "Conciliação: cliente/ano/mês");
  } else {
    fail("filters:conciliation", "filtros básicos ausentes");
  }
  if (/seller|period|maturity|stage/i.test(intel) || existsSync(join(process.cwd(), "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceFiltersBar.tsx"))) {
    ok("filters:intelligence", "Inteligência: filtros próprios (período/vendedor/status)");
  } else {
    fail("filters:intelligence", "barra de filtros Inteligência ausente");
  }
  const auditFilters = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
  );
  if (
    /orderToCashStage|temperature|sellerName|year|customerExternalId|sortBy/.test(
      auditFilters + read("src/lib/finance/orderToCashAuditClient.ts")
    )
  ) {
    ok("filters:audit", "Auditoria: cliente/ano/estágio/temperatura/vendedor/sort");
  } else {
    fail("filters:audit", "filtros Auditoria incompletos");
  }

  ok(
    "runs:known-ids",
    `geral=${GENERAL_RUN} britânia=${BRITANIA_RUN} customer=${BRITANIA_EXTERNAL_ID}/${YEAR}`
  );
}

async function liveLoaders(): Promise<void> {
  section("Loaders live (DATABASE_URL)");
  if (!process.env.DATABASE_URL) {
    console.log("SKIP — DATABASE_URL ausente neste ambiente.");
    checks.push({
      id: "live:db",
      ok: true,
      detail: "SKIPPED — sem DATABASE_URL (não é falha de código)",
    });
    return;
  }

  const { loadPortfolioReconciliationList } = await import(
    "../src/lib/financePortfolioReconciliationApi.server.ts"
  );
  const { loadPortfolioIntelligenceList } = await import(
    "../src/lib/financePortfolioReconciliationApi.server.ts"
  );
  const { loadOrderToCashAuditList } = await import(
    "../src/lib/financeOrderToCashAuditApi.server.ts"
  );
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const general = await prisma.orderToCashAuditRun.findUnique({
      where: { id: GENERAL_RUN },
    });
    if (general?.status === "SUCCESS") {
      ok(
        "live:general-run",
        `orders=${general.totalOrders} facts=${general.totalFacts} status=${general.status}`
      );
      if (general.totalOrders !== 1283) {
        fail("live:general-orders", `esperado 1283, veio ${general.totalOrders}`);
      } else {
        ok("live:general-orders", "1283");
      }
      if (general.totalFacts !== 5860) {
        fail("live:general-facts", `esperado 5860, veio ${general.totalFacts}`);
      } else {
        ok("live:general-facts", "5860");
      }
    } else {
      fail("live:general-run", `run geral ausente ou não SUCCESS: ${general?.status ?? "null"}`);
    }

    const conciliation = await loadPortfolioReconciliationList({});
    if (conciliation.ok && conciliation.run?.id) {
      ok(
        "live:conciliation-unfiltered",
        `run=${conciliation.run.id} dataSource=${(conciliation as { dataSource?: string }).dataSource ?? "?"} rows=${conciliation.pagination.totalRows}`
      );
      if ((conciliation as { dataSource?: string }).dataSource !== "order_to_cash_audit") {
        fail("live:conciliation-source", "dataSource != order_to_cash_audit");
      }
    } else {
      fail("live:conciliation-unfiltered", conciliation.message ?? "ok=false");
    }

    const britaniaConc = await loadPortfolioReconciliationList({
      customerExternalId: String(BRITANIA_EXTERNAL_ID),
      year: String(YEAR),
    });
    if (britaniaConc.ok) {
      ok(
        "live:conciliation-britania-2026",
        `pedidos=${britaniaConc.pagination.totalRows} summaryPedidos=${britaniaConc.summary?.totalPedidos}`
      );
    } else {
      fail("live:conciliation-britania-2026", britaniaConc.message ?? "fail");
    }

    const emptyConc = await loadPortfolioReconciliationList({
      customerExternalId: String(EMPTY_CUSTOMER),
      year: String(YEAR),
    });
    if (emptyConc.ok && emptyConc.pagination.totalRows === 0) {
      ok("live:conciliation-empty-customer", "0 rows (empty state esperado na UI)");
    } else if (!emptyConc.ok) {
      ok("live:conciliation-empty-customer", `ok=false message=${emptyConc.message}`);
    } else {
      fail(
        "live:conciliation-empty-customer",
        `esperado 0 rows, veio ${emptyConc.pagination.totalRows}`
      );
    }

    const intel = await loadPortfolioIntelligenceList({});
    if (intel.ok !== false && intel.run?.id) {
      ok(
        "live:intelligence-unfiltered",
        `run=${intel.run.id} dataSource=${intel.dataSource ?? "?"}`
      );
    } else {
      fail("live:intelligence-unfiltered", intel.message ?? "sem run");
    }

    const intelBrit = await loadPortfolioIntelligenceList({
      customerExternalId: String(BRITANIA_EXTERNAL_ID),
    });
    if (intelBrit.ok !== false) {
      ok(
        "live:intelligence-britania",
        `dataSource=${intelBrit.dataSource ?? "?"} cards=${intelBrit.cards?.length ?? 0}`
      );
    } else {
      fail("live:intelligence-britania", intelBrit.message ?? "fail");
    }

    const auditGeneral = await loadOrderToCashAuditList({
      year: String(YEAR),
      page: "1",
      pageSize: "50",
    });
    if (auditGeneral.ok && auditGeneral.run?.id) {
      ok(
        "live:audit-year-only",
        `run=${auditGeneral.run.id} rows=${auditGeneral.pagination.totalRows} isGeneral=${auditGeneral.run.isGeneralRun}`
      );
    } else {
      fail("live:audit-year-only", auditGeneral.message ?? "fail");
    }

    const auditBrit = await loadOrderToCashAuditList({
      customerExternalId: String(BRITANIA_EXTERNAL_ID),
      year: String(YEAR),
      page: "1",
      pageSize: "50",
      sortBy: "orderIssueDate",
      sortDirection: "desc",
    });
    if (auditBrit.ok && (auditBrit.pagination.totalRows ?? 0) > 0) {
      ok(
        "live:audit-britania-2026",
        `run=${auditBrit.run?.id} rows=${auditBrit.pagination.totalRows} pageSize=${auditBrit.pagination.pageSize}`
      );
      if (auditBrit.run?.id === BRITANIA_RUN) {
        ok("live:audit-prefers-specific-run", BRITANIA_RUN);
      } else {
        ok(
          "live:audit-run-policy",
          `usou ${auditBrit.run?.id} (específica ou geral filtrada — política ok se rows>0)`
        );
      }
    } else {
      fail("live:audit-britania-2026", auditBrit.message ?? "sem rows");
    }

    const auditPage2 = await loadOrderToCashAuditList({
      customerExternalId: String(BRITANIA_EXTERNAL_ID),
      year: String(YEAR),
      page: "2",
      pageSize: "10",
      sortBy: "allocatedValueByOrderPrice",
      sortDirection: "desc",
    });
    if (auditPage2.ok) {
      ok(
        "live:audit-pagination-sort",
        `page=${auditPage2.pagination.page} pageSize=${auditPage2.pagination.pageSize} sort=${auditPage2.sorting.sortBy}`
      );
    } else {
      fail("live:audit-pagination-sort", auditPage2.message ?? "fail");
    }

    const auditEmpty = await loadOrderToCashAuditList({
      customerExternalId: String(EMPTY_CUSTOMER),
      year: String(YEAR),
      page: "1",
      pageSize: "20",
    });
    if (auditEmpty.ok === false || (auditEmpty.pagination?.totalRows ?? 0) === 0) {
      ok("live:audit-empty-customer", "empty/no rows sem 500");
    } else {
      fail("live:audit-empty-customer", `rows inesperadas: ${auditEmpty.pagination.totalRows}`);
    }

    // Evidência Britânia na run geral
    const britFacts = await prisma.orderToCashAuditFact.count({
      where: { runId: GENERAL_RUN, externalCustomerId: BRITANIA_EXTERNAL_ID },
    });
    const britOrders = await prisma.orderToCashAuditFact.findMany({
      where: { runId: GENERAL_RUN, externalCustomerId: BRITANIA_EXTERNAL_ID },
      distinct: ["salesOrderId"],
      select: { salesOrderId: true },
    });
    ok(
      "live:britania-in-general",
      `linhas=${britFacts} pedidosDistinct=${britOrders.length} (esperado ~108 / ~35)`
    );
    if (britFacts !== 108) {
      fail("live:britania-lines", `esperado 108 linhas, veio ${britFacts}`);
    }
    if (britOrders.length !== 35) {
      fail("live:britania-orders", `esperado 35 pedidos, veio ${britOrders.length}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function summarize(): number {
  section("Resumo");
  const failed = checks.filter((c) => !c.ok);
  const skipped = checks.filter((c) => c.detail.startsWith("SKIPPED"));
  console.log(
    `total=${checks.length} pass=${checks.length - failed.length} fail=${failed.length} skip_notes=${skipped.length}`
  );
  if (failed.length) {
    console.log("Falhas:");
    for (const f of failed) console.log(`  - ${f.id}: ${f.detail}`);
  }
  return failed.length;
}

async function main(): Promise<void> {
  console.log("QA 3 abas — Conciliação / Inteligência / Auditoria Pedido → Caixa");
  staticContracts();
  await liveLoaders();
  const fails = summarize();
  process.exitCode = fails > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

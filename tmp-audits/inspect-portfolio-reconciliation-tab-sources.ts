/**
 * Read-only — inventário das fontes das abas da Conciliação de Carteira.
 *
 * Uso:
 *   npx tsx tmp-audits/inspect-portfolio-reconciliation-tab-sources.ts
 *
 * Com DATABASE_URL: consulta runs Portfolio vs OrderToCashAudit.
 * Sem DATABASE_URL: imprime diagnóstico estático do código.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KNOWN_GENERAL_RUN = "41c2470a-b685-4765-a954-77110fd8cf5c";
const KNOWN_BRITANIA_RUN = "a0bdc0b6-b3d5-42ca-a548-283edbc31cfa";
const BRITANIA_EXTERNAL_ID = 200;
const YEAR = 2026;

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function staticCodeMap(): void {
  section("Mapa estático (código)");
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  const auditTab = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
  );
  const auditFilters = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
  );
  const auditServer = read("src/lib/financeOrderToCashAuditApi.server.ts");
  const portfolioServer = read("src/lib/financePortfolioReconciliationApi.server.ts");
  const client = read("src/lib/finance/orderToCashAuditClient.ts");

  console.log(
    "Aba Conciliação endpoint:",
    /\/api\/finance\/portfolio-reconciliation\?/.test(page) ? "OK" : "MISSING"
  );
  console.log(
    "Aba Inteligência endpoint:",
    page.includes("PortfolioIntelligenceSection") ? "via section → /intelligence" : "MISSING"
  );
  console.log(
    "Aba Auditoria endpoint:",
    /ORDER_TO_CASH_AUDIT_API_PATH|order-to-cash-audit/.test(auditTab) ? "OK" : "MISSING"
  );
  console.log(
    "Portfolio resolve run:",
    portfolioServer.includes("portfolioReconciliationRun.findFirst")
      ? "último SUCCESS global"
      : "?"
  );
  console.log(
    "O2C resolve run:",
    auditServer.includes("orderToCashAuditFact.findFirst")
      ? "fato SUCCESS mais recente (cliente+ano)"
      : "?"
  );
  console.log(
    "UI Auditoria envia customerId?",
    /customerId:\s*sel\?\.id/.test(auditFilters) ? "SIM (UUID autocomplete)" : "NÃO"
  );
  console.log(
    "UI Auditoria envia customerExternalId?",
    /customerExternalId:\s*""/.test(auditFilters)
      ? "NÃO — zera externalId ao escolher autocomplete"
      : "verificar"
  );
  console.log(
    "Query builder prioriza externalId?",
    /if \(filters\.customerExternalId\.trim\(\)\)/.test(client) ? "SIM se preenchido" : "?"
  );
  console.log("Runs conhecidas (contexto):");
  console.log(`  geral:    ${KNOWN_GENERAL_RUN}`);
  console.log(`  Britânia: ${KNOWN_BRITANIA_RUN} (externalCustomerId=${BRITANIA_EXTERNAL_ID}, year=${YEAR})`);
}

async function liveDbInspect(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    section("DB live");
    console.log("SKIP — DATABASE_URL ausente. Rode no servidor com .env.");
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    section("PortfolioReconciliationRun (últimas SUCCESS)");
    const portfolioRuns = await prisma.portfolioReconciliationRun.findMany({
      where: { status: "SUCCESS" },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: {
        id: true,
        status: true,
        mode: true,
        finishedAt: true,
        createdAt: true,
        customerExternalId: true,
      },
    });
    for (const r of portfolioRuns) {
      const facts = await prisma.portfolioReconciliationFact.count({
        where: { runId: r.id },
      });
      console.log(
        `  ${r.id.slice(0, 8)}… status=${r.status} mode=${r.mode} facts=${facts} customerExt=${r.customerExternalId ?? "—"}`
      );
    }

    section("OrderToCashAuditRun (últimas SUCCESS)");
    const o2cRuns = await prisma.orderToCashAuditRun.findMany({
      where: { status: "SUCCESS" },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        status: true,
        mode: true,
        year: true,
        customerFilter: true,
        totalFacts: true,
        totalOrders: true,
        periodFrom: true,
        periodTo: true,
        finishedAt: true,
        createdAt: true,
      },
    });
    for (const r of o2cRuns) {
      console.log(
        `  ${r.id} status=${r.status} mode=${r.mode} year=${r.year ?? "null"} customerFilter=${r.customerFilter ?? "null"} facts=${r.totalFacts} orders=${r.totalOrders}`
      );
    }

    section("Runs conhecidas");
    for (const id of [KNOWN_GENERAL_RUN, KNOWN_BRITANIA_RUN]) {
      const run = await prisma.orderToCashAuditRun.findUnique({ where: { id } });
      if (!run) {
        console.log(`  ${id}: NÃO ENCONTRADA`);
        continue;
      }
      const byExt = await prisma.orderToCashAuditFact.count({
        where: { runId: id, externalCustomerId: BRITANIA_EXTERNAL_ID },
      });
      const byYearIssue = await prisma.orderToCashAuditFact.count({
        where: {
          runId: id,
          externalCustomerId: BRITANIA_EXTERNAL_ID,
          orderIssueDate: {
            gte: new Date(YEAR, 0, 1),
            lte: new Date(YEAR, 11, 31, 23, 59, 59, 999),
          },
        },
      });
      console.log(
        `  ${id.slice(0, 8)}… status=${run.status} mode=${run.mode} year=${run.year} filter=${run.customerFilter} | facts Britânia=${byExt} | Britânia+issue ${YEAR}=${byYearIssue}`
      );
    }

    section("Resolução customerId UUID vs externalCustomerId=200");
    const sample = await prisma.orderToCashAuditFact.findFirst({
      where: {
        runId: { in: [KNOWN_GENERAL_RUN, KNOWN_BRITANIA_RUN] },
        externalCustomerId: BRITANIA_EXTERNAL_ID,
      },
      select: {
        customerId: true,
        externalCustomerId: true,
        customerName: true,
        runId: true,
        orderCode: true,
      },
      orderBy: { createdAt: "desc" },
    });
    if (sample) {
      console.log(
        `  sample: order=${sample.orderCode} customerId=${sample.customerId} external=${sample.externalCustomerId} name=${sample.customerName} run=${sample.runId.slice(0, 8)}…`
      );
      if (sample.customerId) {
        const byUuid = await prisma.orderToCashAuditFact.count({
          where: {
            customerId: sample.customerId,
            orderIssueDate: {
              gte: new Date(YEAR, 0, 1),
              lte: new Date(YEAR, 11, 31, 23, 59, 59, 999),
            },
            run: { status: "SUCCESS" },
          },
        });
        console.log(`  count via customerId (UUID) + issue ${YEAR} em runs SUCCESS: ${byUuid}`);
      }
      const byExt = await prisma.orderToCashAuditFact.count({
        where: {
          externalCustomerId: BRITANIA_EXTERNAL_ID,
          orderIssueDate: {
            gte: new Date(YEAR, 0, 1),
            lte: new Date(YEAR, 11, 31, 23, 59, 59, 999),
          },
          run: { status: "SUCCESS" },
        },
      });
      console.log(`  count via externalCustomerId=200 + issue ${YEAR} em runs SUCCESS: ${byExt}`);
    } else {
      console.log("  nenhum fact Britânia nas runs conhecidas");
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("inspect-portfolio-reconciliation-tab-sources (read-only)");
  staticCodeMap();
  await liveDbInspect();
  section("Conclusão rápida");
  console.log(
    "Conciliação/Inteligência → PortfolioReconciliation*; Auditoria → OrderToCashAudit*."
  );
  console.log(
    "UI Auditoria manda customerId UUID; filtro confiável Nomus é externalCustomerId=200."
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/**
 * Read-only — simula a query que a UI da aba Auditoria enviaria
 * e o que resolveLatestSuccessRunId + where de facts retornariam.
 *
 * Uso:
 *   npx tsx tmp-audits/check-order-to-cash-audit-api-query.ts
 *   npx tsx tmp-audits/check-order-to-cash-audit-api-query.ts --customerExternalId 200 --year 2026
 *   npx tsx tmp-audits/check-order-to-cash-audit-api-query.ts --customerId <uuid> --year 2026
 *
 * Não altera dados.
 */
import "dotenv/config";
import {
  buildOrderToCashAuditFactWhere,
  parseOrderToCashAuditListFilters,
  yearDateBounds,
} from "../src/lib/finance/orderToCashAuditApi.ts";
import {
  buildOrderToCashAuditListQuery as buildUiQuery,
  createDefaultOrderToCashAuditUiFilters,
} from "../src/lib/finance/orderToCashAuditClient.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

const year = Number(arg("year") ?? "2026");
const customerExternalIdRaw = arg("customerExternalId") ?? "200";
const customerId = arg("customerId");
const customerExternalId = customerId ? null : Number(customerExternalIdRaw);

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function simulateUiQuery(): void {
  section("Query string que a UI montaria");
  const uiFilters = createDefaultOrderToCashAuditUiFilters({
    year: String(year),
    customerId: customerId ?? "",
    customerExternalId:
      customerId || customerExternalId == null ? "" : String(customerExternalId),
  });
  // Espelha OrderToCashAuditFilters: autocomplete zera externalId
  if (customerId) {
    uiFilters.customerId = customerId;
    uiFilters.customerExternalId = "";
  }
  const qs = buildUiQuery(uiFilters);
  console.log(`  GET /api/finance/portfolio-reconciliation/order-to-cash-audit?${qs}`);

  const parsed = parseOrderToCashAuditListFilters(
    Object.fromEntries(new URLSearchParams(qs).entries())
  );
  console.log("  parsed:", {
    customerId: parsed.customerId,
    customerExternalId: parsed.customerExternalId,
    year: parsed.year,
    sortBy: parsed.sortBy,
    page: parsed.page,
    pageSize: parsed.pageSize,
  });
}

async function liveSimulate(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    section("Simulação live");
    console.log("SKIP — DATABASE_URL ausente.");
    section("O que a API faz (código)");
    console.log("1. Exige customerId|customerExternalId + year (400 se faltar).");
    console.log("2. resolveLatestSuccessRunId:");
    console.log("   - NÃO busca explicitamente 'última run geral sem customerFilter'.");
    console.log("   - NÃO prioriza run com customerFilter=200.");
    console.log("   - Busca fato SUCCESS mais recente (createdAt desc) com cliente +");
    console.log("     (run.year=year OR orderIssueDate no ano).");
    console.log("3. Depois filtra facts do runId com orderIssueDate no ano + cliente.");
    console.log("4. Sem fallback hierárquico específico → geral.");
    console.log("5. mode APPLY e status SUCCESS são UPPERCASE no apply; API checa SUCCESS.");
    return;
  }

  const { PrismaClient, Prisma } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const filters = parseOrderToCashAuditListFilters({
      year: String(year),
      ...(customerId
        ? { customerId }
        : { customerExternalId: String(customerExternalId) }),
      page: "1",
      pageSize: "5",
    });

    section("Passo 1 — candidatos a run (como a API)");
    const yearBounds = yearDateBounds(filters.year);
    const customerWhere =
      filters.customerExternalId != null
        ? { externalCustomerId: filters.customerExternalId }
        : { customerId: filters.customerId! };

    const latestFact = await prisma.orderToCashAuditFact.findFirst({
      where: {
        ...customerWhere,
        run: { status: "SUCCESS" },
        OR: [
          { run: { year: filters.year } },
          { orderIssueDate: { gte: yearBounds.gte, lte: yearBounds.lte } },
        ],
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        runId: true,
        createdAt: true,
        orderCode: true,
        externalCustomerId: true,
        customerId: true,
        orderIssueDate: true,
      },
    });

    if (!latestFact) {
      console.log("  RESULTADO: nenhuma run/fato → UI veria empty com mensagem de run.");
      console.log("  Hipótese: customerId UUID não bate com facts (tente --customerExternalId 200).");
      return;
    }

    const run = await prisma.orderToCashAuditRun.findUnique({
      where: { id: latestFact.runId },
    });
    console.log("  run resolvida:", {
      runId: latestFact.runId,
      status: run?.status,
      mode: run?.mode,
      year: run?.year,
      customerFilter: run?.customerFilter,
      totalFacts: run?.totalFacts,
      sampleOrder: latestFact.orderCode,
    });

    section("Passo 2 — facts no where da listagem");
    const where = buildOrderToCashAuditFactWhere(
      filters,
      latestFact.runId
    ) as import("@prisma/client").Prisma.OrderToCashAuditFactWhereInput;
    const total = await prisma.orderToCashAuditFact.count({ where });
    const sample = await prisma.orderToCashAuditFact.findMany({
      where,
      take: 5,
      orderBy: [{ orderIssueDate: "desc" }, { id: "asc" }],
      select: {
        id: true,
        orderCode: true,
        productCode: true,
        orderToCashStage: true,
        paymentStatus: true,
        allocatedValueByOrderPrice: true,
        receivableTotalValue: true,
        orderIssueDate: true,
      },
    });
    console.log(`  totalRows (paginação): ${total}`);
    for (const row of sample) {
      console.log(
        `  - ${row.orderCode} | ${row.productCode ?? "—"} | stage=${row.orderToCashStage} | pay=${row.paymentStatus} | alloc=${row.allocatedValueByOrderPrice} | issue=${row.orderIssueDate?.toISOString().slice(0, 10)}`
      );
    }

    section("Comparativo: mesma busca por externalCustomerId=200");
    if (filters.customerExternalId !== 200) {
      const latest200 = await prisma.orderToCashAuditFact.findFirst({
        where: {
          externalCustomerId: 200,
          run: { status: "SUCCESS" },
          OR: [
            { run: { year } },
            { orderIssueDate: { gte: yearBounds.gte, lte: yearBounds.lte } },
          ],
        },
        orderBy: [{ createdAt: "desc" }],
        select: { runId: true },
      });
      if (latest200) {
        const whereB = buildOrderToCashAuditFactWhere(
          parseOrderToCashAuditListFilters({
            customerExternalId: "200",
            year: String(year),
          }),
          latest200.runId
        ) as import("@prisma/client").Prisma.OrderToCashAuditFactWhereInput;
        const n = await prisma.orderToCashAuditFact.count({ where: whereB });
        console.log(`  via externalCustomerId=200 → run=${latest200.runId} rows=${n}`);
      } else {
        console.log("  via externalCustomerId=200 → nenhum fato");
      }
    } else {
      console.log("  (já está usando externalCustomerId=200)");
    }

    section("Runs gerais vs específica");
    const general = await prisma.orderToCashAuditRun.findFirst({
      where: { status: "SUCCESS", customerFilter: null },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    });
    const specific = await prisma.orderToCashAuditRun.findFirst({
      where: {
        status: "SUCCESS",
        customerFilter: "200",
        year,
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    });
    console.log(
      `  última geral (customerFilter null): ${general?.id ?? "—"} mode=${general?.mode} facts=${general?.totalFacts}`
    );
    console.log(
      `  última Britânia 2026 (filter=200,year): ${specific?.id ?? "—"} mode=${specific?.mode} facts=${specific?.totalFacts}`
    );
    console.log(
      `  API atual escolheria: ${latestFact.runId} (fato mais recente, NÃO hierarquia geral/específica)`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("check-order-to-cash-audit-api-query (read-only)");
  simulateUiQuery();
  await liveSimulate();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

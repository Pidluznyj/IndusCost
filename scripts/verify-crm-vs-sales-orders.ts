/**
 * Verificador de reconciliação: Pedidos de Venda (oficial) × CRM Gestão Geral.
 *
 * SOMENTE LEITURA. Não escreve, não migra, não altera nada — só consulta e
 * imprime a tabela de conferência. Feito para rodar em homologação antes de
 * liberar o cockpit ao gestor comercial.
 *
 * Uso:
 *   npx tsx scripts/verify-crm-vs-sales-orders.ts                # 2026, mês atual, mês fechado e todos os anos
 *   npx tsx scripts/verify-crm-vs-sales-orders.ts --year=2026
 *   npx tsx scripts/verify-crm-vs-sales-orders.ts --year=2026 --month=7
 *   npx tsx scripts/verify-crm-vs-sales-orders.ts --all-years
 *   npx tsx scripts/verify-crm-vs-sales-orders.ts --json
 *
 * Critério (definido pelo negócio):
 *   dinheiro    → delta obrigatório R$ 0,00
 *   quantidade  → delta obrigatório 0
 *
 * Indicadores conferidos:
 *   total de pedidos · valor vendido · quantidade em carteira · valor em carteira
 */

import { PrismaClient } from "@prisma/client";
import { buildSalesOrderListWhere } from "../src/lib/salesOrdersListSummary.ts";
import { mapPrismaOrderToSalesOrderRulesInput, resolveOfficialScopedOrderMetrics } from "../src/lib/salesOrderRulesAdapter.ts";
import { SALES_ORDER_RULES_PRISMA_SELECT } from "../src/lib/salesOrderRulesAdapter.ts";
import { loadSalesOrderLinkedNfeContextMap } from "../src/lib/salesOrderLinkedNfe.ts";
import { loadCrmSalesOrderMetrics } from "../src/lib/commercial/crmSalesOrderMetricsService.ts";

type Scenario = { label: string; year?: number; month?: number; allYears?: boolean };

type Row = {
  scenario: string;
  indicator: string;
  kind: "money" | "count";
  pv: number;
  crm: number;
  delta: number;
  status: "OK" | "DIVERGENTE";
};

const prisma = new PrismaClient();

function parseArgs(argv: string[]): { scenarios: Scenario[]; json: boolean } {
  const json = argv.includes("--json");
  const get = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split("=")[1]! : null;
  };
  const yearArg = get("year");
  const monthArg = get("month");
  const allYears = argv.includes("--all-years");

  if (yearArg || monthArg || allYears) {
    return {
      json,
      scenarios: [
        {
          label: allYears
            ? "todos os anos"
            : monthArg
              ? `${monthArg}/${yearArg}`
              : `ano ${yearArg}`,
          year: yearArg ? Number(yearArg) : undefined,
          month: monthArg ? Number(monthArg) : undefined,
          allYears,
        },
      ],
    };
  }

  // Bateria padrão combinada com o negócio.
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const closedMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const closedMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  return {
    json,
    scenarios: [
      { label: `ano ${currentYear}`, year: currentYear },
      { label: `mês atual (${currentMonth}/${currentYear})`, year: currentYear, month: currentMonth },
      {
        label: `mês fechado (${closedMonth}/${closedMonthYear})`,
        year: closedMonthYear,
        month: closedMonth,
      },
      { label: "todos os anos", allYears: true },
    ],
  };
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Lado OFICIAL: mesma população e mesmo motor da tela Pedidos de Venda. */
async function readSalesOrdersSide(scenario: Scenario) {
  const where = buildSalesOrderListWhere(
    {
      year: scenario.allYears ? undefined : scenario.year,
      month: scenario.allYears ? undefined : scenario.month,
    },
    { excludeEconomicGroupCustomers: true }
  );

  const rows = await prisma.salesOrder.findMany({
    where: where as never,
    select: SALES_ORDER_RULES_PRISMA_SELECT as never,
  });

  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    (rows as Array<Record<string, unknown>>).map((order) => ({
      id: order.id as string,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate as Date,
      expectedDeliveryDate: (order.expectedDeliveryDate as Date | null) ?? null,
      nomusRawResponse: order.nomusRawResponse,
    })),
    new Date()
  );

  const official = resolveOfficialScopedOrderMetrics({
    orders: (rows as never[]).map((row) => mapPrismaOrderToSalesOrderRulesInput(row as never)),
    referenceDate: new Date(),
    managementFilters: { allYears: true },
    linkedNfeContextMap: linkedMap,
  });

  return {
    totalOrders: official.filteredOrders,
    soldAmount: round2(official.soldAmount),
    openPortfolioCount: official.openPortfolioCount,
    openPortfolioAmount: round2(official.openPortfolioAmount),
  };
}

/** Lado CRM: exatamente o que o cockpit publica. */
async function readCrmSide(scenario: Scenario) {
  const metrics = await loadCrmSalesOrderMetrics(prisma, {
    year: scenario.allYears ? null : (scenario.year ?? null),
    month: scenario.allYears ? null : (scenario.month ?? null),
    allYears: scenario.allYears ?? false,
  });
  return {
    totalOrders: metrics.totalOrders,
    soldAmount: round2(metrics.totalOrderValue),
    openPortfolioCount: metrics.openPortfolioOrders,
    openPortfolioAmount: round2(metrics.openPortfolioValue),
    truncated: metrics.debug.truncated === true,
    matchedOrderCount: metrics.debug.matchedOrderCount ?? null,
  };
}

function compare(scenario: string, pv: Awaited<ReturnType<typeof readSalesOrdersSide>>, crm: Awaited<ReturnType<typeof readCrmSide>>): Row[] {
  const build = (indicator: string, kind: Row["kind"], a: number, b: number): Row => {
    const delta = round2(b - a);
    return {
      scenario,
      indicator,
      kind,
      pv: a,
      crm: b,
      delta,
      // Tolerância zero, por decisão do negócio.
      status: delta === 0 ? "OK" : "DIVERGENTE",
    };
  };
  return [
    build("total de pedidos", "count", pv.totalOrders, crm.totalOrders),
    build("valor vendido", "money", pv.soldAmount, crm.soldAmount),
    build("quantidade em carteira", "count", pv.openPortfolioCount, crm.openPortfolioCount),
    build("valor em carteira", "money", pv.openPortfolioAmount, crm.openPortfolioAmount),
  ];
}

const money = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function printTable(rows: Row[]): void {
  const header = ["cenário", "indicador", "PV", "CRM", "delta", "status"];
  const body = rows.map((r) => [
    r.scenario,
    r.indicator,
    r.kind === "money" ? money(r.pv) : String(r.pv),
    r.kind === "money" ? money(r.crm) : String(r.crm),
    r.kind === "money" ? money(r.delta) : String(r.delta),
    r.status,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((line) => line[i]!.length))
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const cells of body) console.log(line(cells));
}

async function main(): Promise<void> {
  const { scenarios, json } = parseArgs(process.argv.slice(2));
  const rows: Row[] = [];
  const warnings: string[] = [];

  for (const scenario of scenarios) {
    const [pv, crm] = await Promise.all([
      readSalesOrdersSide(scenario),
      readCrmSide(scenario),
    ]);
    if (crm.truncated) {
      warnings.push(
        `[${scenario.label}] CRM truncou a carga (${crm.matchedOrderCount} pedidos casam o filtro) — números do cockpit subestimados.`
      );
    }
    rows.push(...compare(scenario.label, pv, crm));
  }

  if (json) {
    console.log(JSON.stringify({ rows, warnings }, null, 2));
  } else {
    printTable(rows);
    for (const w of warnings) console.log(`\nAVISO: ${w}`);
  }

  const divergent = rows.filter((r) => r.status === "DIVERGENTE");
  if (divergent.length > 0) {
    console.log(`\n${divergent.length} indicador(es) DIVERGENTE(s) — reconciliação NÃO aprovada.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nTodos os indicadores reconciliam (delta zero). Reconciliação aprovada.");
}

main()
  .catch((error) => {
    console.error("Falha no verificador:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

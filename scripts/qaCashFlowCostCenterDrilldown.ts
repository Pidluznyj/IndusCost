/**
 * QA estático — Centros de custo no drilldown do Fluxo de Caixa.
 *
 * Uso: npx tsx scripts/qaCashFlowCostCenterDrilldown.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCashFlowCostCenterSummary,
  CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID,
  extractPayableExternalId,
  filterCashFlowCostCenterTitles,
} from "../src/lib/financeCashFlowDailyRadarCostCenters.js";
import type { DailyRadarPayableRow } from "../src/lib/financeCashFlowDailyRadar.js";

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

function makePayable(
  externalId: number,
  amount: number,
  extras: Partial<DailyRadarPayableRow> = {}
): DailyRadarPayableRow {
  return {
    id: `ap-${externalId}`,
    supplier: `Fornecedor ${externalId}`,
    company: "Empresa X",
    description: `Título ${externalId}`,
    document: String(externalId),
    operationalDate: "2026-07-15",
    dueDate: "2026-07-15",
    scheduleDate: null,
    amount,
    status: "OPEN",
    paymentMethod: null,
    rescheduled: false,
    vencimentoOficial: "2026-07-15",
    dataAgendada: null,
    dataPagamento: null,
    dataUsadaNoFluxo: "2026-07-15",
    fonteDataFluxo: "vencimento",
    ...extras,
  };
}

function testUnclassifiedBucket(): void {
  const summary = buildCashFlowCostCenterSummary({
    payables: [makePayable(1, 500), makePayable(2, 200)],
    allocations: [],
    costCenters: [],
    scope: {
      level: "range",
      rangeKey: "0-7",
      rangeLabel: "0 a 7 dias",
      dateFrom: null,
      dateTo: null,
      day: null,
      search: null,
    },
  });
  const uc = summary.items.find(
    (i) => i.costCenterId === CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID
  );
  if (!uc) return fail("bucket:unclassified", "Card Sem centro de custo ausente");
  if (Math.abs(uc.amount - 700) > 0.01)
    return fail("bucket:unclassified", `Valor errado: ${uc.amount}`);
  if (uc.titlesCount !== 2)
    return fail("bucket:unclassified", `titlesCount errado: ${uc.titlesCount}`);
  ok("bucket:unclassified", "Sem centro de custo agrega títulos e valor");
}

function testAggregation(): void {
  const summary = buildCashFlowCostCenterSummary({
    payables: [
      makePayable(10, 1000),
      makePayable(11, 300),
      makePayable(12, 500),
    ],
    allocations: [
      { accountsPayableExternalId: 10, costCenterId: "cc-a", amount: 1000, percentage: 100 },
      { accountsPayableExternalId: 11, costCenterId: "cc-b", amount: null, percentage: 100 },
      { accountsPayableExternalId: 12, costCenterId: "cc-a", amount: 300, percentage: 60 },
      { accountsPayableExternalId: 12, costCenterId: "cc-b", amount: 200, percentage: 40 },
    ],
    costCenters: [
      { id: "cc-a", code: "A", name: "Centro A", status: "ACTIVE" },
      { id: "cc-b", code: "B", name: "Centro B", status: "ACTIVE" },
    ],
    scope: {
      level: "day",
      rangeKey: "0-7",
      rangeLabel: "0 a 7 dias",
      dateFrom: null,
      dateTo: null,
      day: "2026-07-15",
      search: null,
    },
  });
  const totalCards = summary.items.reduce((s, i) => s + i.amount, 0);
  if (Math.abs(totalCards - 1800) > 0.01)
    return fail("agg:total", `Soma dos cards ${totalCards} != 1800`);
  const a = summary.items.find((i) => i.costCenterId === "cc-a");
  const b = summary.items.find((i) => i.costCenterId === "cc-b");
  if (!a || !b) return fail("agg:cards", "Cards A/B ausentes");
  if (Math.abs(a.amount - 1300) > 0.01)
    return fail("agg:cardA", `Centro A ${a.amount} != 1300`);
  if (Math.abs(b.amount - 500) > 0.01)
    return fail("agg:cardB", `Centro B ${b.amount} != 500`);
  if (summary.totalAmount !== 1800)
    return fail("agg:total-payload", `total ${summary.totalAmount} != 1800`);
  ok(
    "agg:basic",
    "Soma dos cards bate com o total de saídas; rateio 60/40 aplicado; ordenação desc"
  );
  if (summary.items[0]!.costCenterId !== "cc-a")
    return fail("agg:sort", "Ordenação desc por valor quebrou");
  ok("agg:sort", "Ordenação desc por valor OK");
}

function testDrawerTitles(): void {
  const titles = filterCashFlowCostCenterTitles({
    payables: [makePayable(20, 500), makePayable(21, 250)],
    allocations: [
      { accountsPayableExternalId: 20, costCenterId: "cc-a", amount: 500, percentage: 100 },
    ],
    costCenterId: "cc-a",
  });
  if (titles.length !== 1 || titles[0]!.accountsPayableExternalId !== 20) {
    return fail("drawer:cc-a", "Drawer do centro A deveria conter só o título 20");
  }
  const unclassified = filterCashFlowCostCenterTitles({
    payables: [makePayable(20, 500), makePayable(21, 250)],
    allocations: [
      { accountsPayableExternalId: 20, costCenterId: "cc-a", amount: 500, percentage: 100 },
    ],
    costCenterId: CASH_FLOW_COST_CENTER_UNCLASSIFIED_ID,
  });
  if (unclassified.length !== 1 || unclassified[0]!.accountsPayableExternalId !== 21) {
    return fail(
      "drawer:unclassified",
      "Drawer Sem centro de custo deveria conter só o título 21"
    );
  }
  ok("drawer:titles", "Drawer entrega apenas os títulos do bucket selecionado");
}

function testExtractExternalId(): void {
  if (extractPayableExternalId("ap-42") !== 42) {
    return fail("id:extract", "extractPayableExternalId('ap-42') != 42");
  }
  if (extractPayableExternalId("ar-42") !== null) {
    return fail("id:extract-non-ap", "AR não pode virar externalId");
  }
  ok("id:extract", "extractPayableExternalId identifica só linhas AP");
}

function testStaticContracts(): void {
  if (!exists("src/lib/financeCashFlowDailyRadarCostCenters.ts")) {
    return fail("static:module", "builder ausente");
  }
  ok("static:module", "builder existe");

  const routes = read("src/lib/financeCashFlowRoutes.ts");
  if (!routes.includes("/api/finance/cash-flow/daily-radar/cost-centers")) {
    return fail("static:route", "rota GET ausente");
  }
  if (!routes.includes("/api/finance/cash-flow/daily-radar/cost-centers/titles")) {
    return fail("static:route-titles", "rota de detalhe ausente");
  }
  if (
    !routes.includes("prisma.accountsPayableCostCenterAllocation.findMany") ||
    !routes.includes("prisma.financialCostCenter.findMany")
  ) {
    return fail("static:route-source", "rota não usa AccountsPayableCostCenterAllocation + FinancialCostCenter");
  }
  ok(
    "static:route",
    "Endpoints daily-radar/cost-centers + /titles registrados usando allocation/CC"
  );

  const section = read(
    "src/components/finance/cash-flow/FinanceCashFlowCostCentersSection.tsx"
  );
  if (!section.includes("Centros de custo das saídas")) {
    return fail("static:title", "título 'Centros de custo das saídas' ausente");
  }
  if (!section.includes("Sem centro de custo")) {
    return fail("static:unclassified", "card 'Sem centro de custo' não implementado");
  }
  if (!section.includes("buildDailyRadarQuery")) {
    return fail("static:filters", "seção não usa buildDailyRadarQuery para herdar filtros");
  }
  if (/@prisma\/client/.test(section) || section.includes("prisma.js")) {
    return fail("static:no-prisma", "frontend não pode importar Prisma");
  }
  ok("static:frontend", "Seção frontend não importa Prisma e reaproveita buildDailyRadarQuery");

  const radar = read(
    "src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx"
  );
  if (!radar.includes("FinanceCashFlowCostCentersSection")) {
    return fail("static:integration", "seção não foi integrada ao radar diário");
  }
  // Compara pela última ocorrência de renderização (JSX), não pela linha do import.
  const receivablesIdx = radar.lastIndexOf("<ReceivablesGrid");
  const sectionIdx = radar.lastIndexOf("<FinanceCashFlowCostCentersSection");
  if (receivablesIdx === -1 || sectionIdx === -1 || sectionIdx < receivablesIdx) {
    return fail(
      "static:position",
      "Seção deve aparecer DEPOIS de <ReceivablesGrid>"
    );
  }
  ok("static:integration", "Seção renderizada abaixo do grid de Contas a Receber");
}

function main(): void {
  console.log("=== qaCashFlowCostCenterDrilldown (static + unit) ===\n");
  testStaticContracts();
  testExtractExternalId();
  testUnclassifiedBucket();
  testAggregation();
  testDrawerTitles();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${failed} falha(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

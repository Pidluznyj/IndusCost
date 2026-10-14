/**
 * Recebíveis Mensais — conferência da seleção por vencimento com dados reais (read-only).
 *
 * Para cada período, roda o relatório duas vezes com os mesmos filtros:
 *   SELEÇÃO    caminho novo: candidatos pela carga em lote + cálculo canônico neles;
 *   REFERÊNCIA sem pré-seleção: cálculo canônico (auditoria 360º) em TODOS os pedidos,
 *              sem o antigo corte de 500.
 * Aceite: nenhum pedido faltando ou sobrando e nenhuma divergência de valor.
 *
 * SOMENTE LEITURA, garantido em execução: um middleware do Prisma deixa passar só
 * operações de leitura (find*, count, aggregate, groupBy, queryRaw) e interrompe o script
 * na primeira tentativa de escrita, antes de ela chegar ao banco. Não há cliente HTTP do
 * Nomus nem escrita em arquivo no caminho.
 *
 * BANCO: antes de qualquer consulta, mostra host e nome do banco de DATABASE_URL (sem
 * usuário/senha) e só segue com --confirm-db=<nome do banco> igual ao da URL.
 *
 * SAÍDA: contagens, tempos, consultas por operação, memória e códigos de pedido. Valores
 * por pedido só aparecem para pedidos divergentes. Sem cliente, CNPJ ou descrição.
 *
 * A referência faz uma auditoria 360º por pedido da população — rode fora do pico.
 *
 * Uso:
 *   node node_modules/tsx/dist/cli.mjs scripts/auditMonthlyReceivablesSelection.ts --confirm-db=<banco>
 *     (sem período: roda os três cenários padrão)
 *   ... --confirm-db=<banco> --from=2026-10 --to=2026-12 [--startDate=AAAA-MM-DD --endDate=AAAA-MM-DD]
 * Sai com código 1 se houver qualquer divergência; 2 se o banco não for confirmado.
 */
import { prisma } from "@/src/lib/prisma.js";
import { getOrderFullAudit } from "@/src/lib/finance/orderFullAuditService.js";
import { loadCashFlowOrderProjections } from "@/src/lib/finance/cashFlowOrderProjectionLoader.server.js";
import type {
  SalesOrderMonthlyReceivablesReportPayload,
  SalesOrderMonthlyReceivablesRow,
} from "@/src/lib/sales/salesOrderMonthlyReceivablesReport.js";
import {
  loadSalesOrderMonthlyReceivablesReportPayload,
  type MonthlyReceivablesReportDeps,
} from "@/src/lib/sales/salesOrderMonthlyReceivablesReportService.server.js";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/* -- 1. Banco: identificar e exigir confirmação explícita -------------------------- */
function describeDatabase(): { host: string; database: string } | null {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return { host: `${url.hostname}${url.port ? `:${url.port}` : ""}`, database: url.pathname.replace(/^\//, "") };
  } catch {
    return null;
  }
}
const db = describeDatabase();
console.error(`[audit] banco: ${db ? `${db.database} em ${db.host}` : "DATABASE_URL ausente ou inválida"}`);
if (!db || arg("confirm-db") !== db.database) {
  console.error("[audit] interrompido: informe --confirm-db=<nome do banco> igual ao exibido acima.");
  process.exit(2);
}

/* -- 2. Só leitura, garantido em execução + contagem de consultas ------------------ */
const READ_ACTIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "queryRaw",
  "findRaw",
  "aggregateRaw",
]);
let queryCounts = new Map<string, number>();
prisma.$use(async (params, next) => {
  if (!READ_ACTIONS.has(params.action)) {
    throw new Error(`[audit] escrita bloqueada: ${params.model ?? "raw"}.${params.action}`);
  }
  const key = `${params.model ?? "raw"}.${params.action}`;
  queryCounts.set(key, (queryCounts.get(key) ?? 0) + 1);
  return next(params);
});

/* -- 3. Cenários ------------------------------------------------------------------- */
type Scenario = { name: string; query: Record<string, string> };
const explicit = arg("from") || arg("to");
const scenarios: Scenario[] = explicit
  ? [
      {
        name: "informado",
        query: Object.fromEntries(
          [
            ["dueMonthFrom", arg("from")],
            ["dueMonthTo", arg("to")],
            ["startDate", arg("startDate")],
            ["endDate", arg("endDate")],
          ].filter((entry): entry is [string, string] => Boolean(entry[1]))
        ),
      },
    ]
  : [
      { name: "out–dez/2026", query: { dueMonthFrom: "2026-10", dueMonthTo: "2026-12" } },
      { name: "jan–dez/2026", query: { dueMonthFrom: "2026-01", dueMonthTo: "2026-12" } },
      {
        name: "emitidos em 2025, vencimento em 2026",
        query: { dueMonthFrom: "2026-01", dueMonthTo: "2026-12", startDate: "2025-01-01", endDate: "2025-12-31" },
      },
    ];

let fullAudits = 0;
const countingAudit = (async (input: Parameters<typeof getOrderFullAudit>[0]) => {
  fullAudits += 1;
  return getOrderFullAudit(input);
}) as typeof getOrderFullAudit;

const selectionDeps: MonthlyReceivablesReportDeps = {
  loadProjections: loadCashFlowOrderProjections,
  getOrderFullAudit: countingAudit,
};
function referenceDeps(dueMonthFrom: string): MonthlyReceivablesReportDeps {
  return {
    // Todo pedido vira candidato: o cálculo canônico decide sozinho.
    loadProjections: async (_prisma, input) =>
      new Map(input.salesOrderIds.map((id) => [id, { receivables: [], plannedReceivables: [{ dueDate: dueMonthFrom }] }])),
    getOrderFullAudit: countingAudit,
  };
}

async function measure(run: () => Promise<SalesOrderMonthlyReceivablesReportPayload>) {
  queryCounts = new Map();
  fullAudits = 0;
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 50);
  const t0 = performance.now();
  try {
    const payload = await run();
    return {
      payload,
      ms: Math.round(performance.now() - t0),
      fullAudits,
      queries: [...queryCounts.values()].reduce((s, n) => s + n, 0),
      queriesByOperation: Object.fromEntries([...queryCounts].sort((a, b) => b[1] - a[1])),
      peakRssMb: Math.round(Math.max(peakRss, process.memoryUsage().rss) / 1024 / 1024),
    };
  } finally {
    clearInterval(sampler);
  }
}

/** Campos financeiros comparados por pedido e por mês. */
function rowSignature(row: SalesOrderMonthlyReceivablesRow) {
  return {
    effectiveScheduleTotal: row.effectiveScheduleTotal,
    periodScheduleTotal: row.periodScheduleTotal,
    outsidePeriodTotal: row.outsidePeriodTotal,
    difference: row.difference,
    qualityStatus: row.qualityStatus,
    months: Object.fromEntries(
      Object.entries(row.months).map(([key, cell]) => [
        key,
        { amount: cell.amount, titleCount: cell.titleCount, openAmount: cell.openAmount, receivedAmount: cell.receivedAmount },
      ])
    ),
  };
}

const referenceDate = new Date();
const report: unknown[] = [];
let divergent = false;

for (const scenario of scenarios) {
  const query: Record<string, string> = { ...scenario.query, includeAllRows: "1" };
  const selection = await measure(() =>
    loadSalesOrderMonthlyReceivablesReportPayload(prisma, { query, referenceDate }, selectionDeps)
  );
  const reference = await measure(() =>
    loadSalesOrderMonthlyReceivablesReportPayload(prisma, { query, referenceDate }, referenceDeps(query.dueMonthFrom!))
  );

  const sel = new Map(selection.payload.rows.map((r) => [r.salesOrderId, r]));
  const ref = new Map(reference.payload.rows.map((r) => [r.salesOrderId, r]));
  const missing = [...ref.values()].filter((r) => !sel.has(r.salesOrderId)).map((r) => r.orderCode);
  const extra = [...sel.values()].filter((r) => !ref.has(r.salesOrderId)).map((r) => r.orderCode);
  const valueDivergences = [...ref.values()]
    .filter((r) => sel.has(r.salesOrderId))
    .filter((r) => JSON.stringify(rowSignature(r)) !== JSON.stringify(rowSignature(sel.get(r.salesOrderId)!)))
    .map((r) => ({ orderCode: r.orderCode, selection: rowSignature(sel.get(r.salesOrderId)!), reference: rowSignature(r) }));
  const totalsMatch = JSON.stringify(selection.payload.totals) === JSON.stringify(reference.payload.totals);
  const ok = missing.length === 0 && extra.length === 0 && valueDivergences.length === 0 && totalsMatch;
  if (!ok) divergent = true;

  const { payload: selPayload, ...selMetrics } = selection;
  const { payload: refPayload, ...refMetrics } = reference;
  report.push({
    scenario: scenario.name,
    query: scenario.query,
    verdict: ok ? "EQUIVALENTE" : "DIVERGENTE",
    orders: {
      population: selPayload.selection.populationOrders,
      candidates: selPayload.selection.candidateOrders,
      eligibleSelection: selPayload.selection.eligibleOrders,
      eligibleReference: refPayload.selection.eligibleOrders,
      rowsSelection: selPayload.rows.length,
      rowsReference: refPayload.rows.length,
      failedSelection: selPayload.selection.failedOrders,
      failedReference: refPayload.selection.failedOrders,
    },
    totals: {
      match: totalsMatch,
      periodScheduleTotal: [selPayload.totals.periodScheduleTotal, refPayload.totals.periodScheduleTotal],
      titleCount: [selPayload.totals.titleCount, refPayload.totals.titleCount],
      monthly: Object.fromEntries(
        Object.keys(refPayload.totals.monthly).map((key) => [
          key,
          { selection: selPayload.totals.monthly[key], reference: refPayload.totals.monthly[key] },
        ])
      ),
    },
    missingFromSelection: missing,
    extraInSelection: extra,
    valueDivergences,
    performance: { selection: selMetrics, reference: refMetrics },
    warnings: { selection: selPayload.warnings, reference: refPayload.warnings },
  });
}

console.log(JSON.stringify({ database: db, referenceDate: referenceDate.toISOString(), divergent, scenarios: report }, null, 2));
await prisma.$disconnect();
if (divergent) process.exitCode = 1;

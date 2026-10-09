/**
 * Auditoria READ-ONLY — status de Faturamento da grade × motor operacional.
 *
 * Compara, por pedido:
 *   - regra anterior: cabeçalho das NF vinculadas × valor líquido do pedido;
 *   - regra atual: `loadSalesOrderLinkedNfeContextMap` (cabeçalho quando a NF é
 *     exclusiva do pedido; progresso operacional quando não é);
 *   - motor operacional: `SalesOrderFlowSnapshot.progressInvoiced`.
 *
 * Mostra se o caso PD 02959 (NF de vários pedidos) é isolado ou uma classe.
 * Só executa SELECT (findMany). Não grava, não recalcula snapshot.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-order-billing-status-vs-flow.ts
 *   npx tsx scripts/audit-sales-order-billing-status-vs-flow.ts --from=2026-01-01 --to=2026-10-31
 *   npx tsx scripts/audit-sales-order-billing-status-vs-flow.ts --order=02959
 *   npx tsx scripts/audit-sales-order-billing-status-vs-flow.ts --json > divergencias.json
 *
 * Opções:
 *   --from / --to   janela de `SalesOrder.issueDate` (padrão: últimos 365 dias)
 *   --order         filtra por trecho do código do pedido (ignora a janela)
 *   --all           lista também pedidos sem divergência
 *   --json          saída JSON (resumo + linhas)
 */
import "dotenv/config";
import { decimalToNumber } from "../src/lib/executiveDashboardHelpers.ts";
import { prisma } from "../src/lib/prisma.ts";
import {
  isInvoiceCoverageComplete,
  loadSalesOrderLinkedNfeContextMap,
  OPERATIONAL_INVOICED_PROGRESS_FULL_TOLERANCE,
} from "../src/lib/salesOrderLinkedNfe.ts";
import {
  resolveSalesOrderBillingStatus,
  type SalesOrderBillingStatus,
} from "../src/lib/sales/salesOrderListBillingStatus.ts";

const BATCH_SIZE = 500;
const DEFAULT_WINDOW_DAYS = 365;

type DivergenceClass =
  | "OK"
  | "NO_FLOW_SNAPSHOT"
  | "GRID_PARTIAL_FLOW_FULL"
  | "GRID_INVOICED_FLOW_PARTIAL"
  | "GRID_INVOICED_FLOW_ZERO"
  | "GRID_PARTIAL_FLOW_ZERO"
  | "GRID_NOT_INVOICED_FLOW_HAS_INVOICED";

type AuditRow = {
  orderCode: string | null;
  salesOrderId: string;
  issueDate: string | null;
  totalNetValue: number | null;
  nfeHeaderTotalValue: number;
  nfeCount: number;
  hasNfeSharedAcrossOrders: boolean;
  coverageBasis: string;
  previousRuleStatus: SalesOrderBillingStatus;
  currentRuleStatus: SalesOrderBillingStatus;
  flowStage: string | null;
  flowProgressInvoiced: number | null;
  flowStatus: SalesOrderBillingStatus | null;
  /** Divergência da regra anterior (cabeçalho) contra o motor operacional. */
  previousRuleDivergence: DivergenceClass;
  /** Divergência que permanece com a regra atual. */
  currentRuleDivergence: DivergenceClass;
};

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseDateArg(name: string): Date | null {
  const raw = readArg(name);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--${name} inválido: use AAAA-MM-DD.`);
  }
  return date;
}

function flowStatusFromProgress(
  orderStatus: string | null,
  progressInvoiced: number | null
): SalesOrderBillingStatus | null {
  if ((orderStatus ?? "").trim().toUpperCase() === "CANCELLED") return "CANCELED";
  if (progressInvoiced == null) return null;
  if (progressInvoiced >= 100 - OPERATIONAL_INVOICED_PROGRESS_FULL_TOLERANCE) return "INVOICED";
  if (progressInvoiced > 0) return "PARTIALLY_INVOICED";
  return "NOT_INVOICED";
}

function classify(
  gridStatus: SalesOrderBillingStatus,
  flowStatus: SalesOrderBillingStatus | null
): DivergenceClass {
  if (flowStatus == null) return "NO_FLOW_SNAPSHOT";
  if (gridStatus === flowStatus || gridStatus === "CANCELED") return "OK";
  if (gridStatus === "PARTIALLY_INVOICED") {
    return flowStatus === "INVOICED" ? "GRID_PARTIAL_FLOW_FULL" : "GRID_PARTIAL_FLOW_ZERO";
  }
  if (gridStatus === "INVOICED") {
    return flowStatus === "PARTIALLY_INVOICED"
      ? "GRID_INVOICED_FLOW_PARTIAL"
      : "GRID_INVOICED_FLOW_ZERO";
  }
  return "GRID_NOT_INVOICED_FLOW_HAS_INVOICED";
}

function countBy(rows: AuditRow[], pick: (row: AuditRow) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = pick(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function main(): Promise<void> {
  const orderFilter = readArg("order");
  const to = parseDateArg("to") ?? new Date();
  const from =
    parseDateArg("from") ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const where = orderFilter
    ? { orderCode: { contains: orderFilter } }
    : { issueDate: { gte: from, lte: to } };

  const rows: AuditRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const orders = await prisma.salesOrder.findMany({
      where,
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        orderCode: true,
        status: true,
        totalNetValue: true,
        issueDate: true,
        expectedDeliveryDate: true,
      },
    });
    if (orders.length === 0) break;
    cursor = orders[orders.length - 1]!.id;

    const [contextMap, snapshots] = await Promise.all([
      loadSalesOrderLinkedNfeContextMap(orders, new Date(), { omitLinkRawPayload: true }),
      prisma.salesOrderFlowSnapshot.findMany({
        where: { salesOrderId: { in: orders.map((order) => order.id) } },
        select: { salesOrderId: true, currentStage: true, progressInvoiced: true },
      }),
    ]);
    const snapshotByOrderId = new Map(snapshots.map((row) => [row.salesOrderId, row]));

    for (const order of orders) {
      const ctx = contextMap.get(order.id);
      const totalNetValue = decimalToNumber(order.totalNetValue);
      const hasNfe = ctx?.hasNfe ?? false;
      const headerTotal = ctx?.nfeTotalValue ?? 0;
      const headerFull = isInvoiceCoverageComplete(headerTotal, totalNetValue);
      const previousRuleStatus = resolveSalesOrderBillingStatus({
        status: order.status,
        hasNfe,
        isFullyInvoiced: headerFull,
        isPartiallyInvoiced: hasNfe && !headerFull && headerTotal > 0,
      });
      const currentRuleStatus = resolveSalesOrderBillingStatus({
        status: order.status,
        hasNfe,
        isFullyInvoiced: ctx?.isFullyInvoiced,
        isPartiallyInvoiced: ctx?.isPartiallyInvoiced,
      });
      const snapshot = snapshotByOrderId.get(order.id) ?? null;
      const flowProgressInvoiced = snapshot ? decimalToNumber(snapshot.progressInvoiced) : null;
      const flowStatus = flowStatusFromProgress(order.status, flowProgressInvoiced);
      rows.push({
        orderCode: order.orderCode,
        salesOrderId: order.id,
        issueDate: order.issueDate ? order.issueDate.toISOString().slice(0, 10) : null,
        totalNetValue,
        nfeHeaderTotalValue: headerTotal,
        nfeCount: ctx?.validInvoiceCount ?? 0,
        hasNfeSharedAcrossOrders: ctx?.hasNfeSharedAcrossOrders ?? false,
        coverageBasis: ctx?.invoiceCoverageBasis ?? "nfe_header_value",
        previousRuleStatus,
        currentRuleStatus,
        flowStage: snapshot?.currentStage ?? null,
        flowProgressInvoiced,
        flowStatus,
        previousRuleDivergence: classify(previousRuleStatus, flowStatus),
        currentRuleDivergence: classify(currentRuleStatus, flowStatus),
      });
    }
    if (orders.length < BATCH_SIZE) break;
  }

  const isDivergent = (row: AuditRow) =>
    (row.previousRuleDivergence !== "OK" && row.previousRuleDivergence !== "NO_FLOW_SNAPSHOT") ||
    (row.currentRuleDivergence !== "OK" && row.currentRuleDivergence !== "NO_FLOW_SNAPSHOT");
  const divergent = rows.filter(isDivergent);
  const summary = {
    scope: orderFilter
      ? { order: orderFilter }
      : { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    ordersAudited: rows.length,
    ordersWithSharedNfe: rows.filter((row) => row.hasNfeSharedAcrossOrders).length,
    previousRuleDivergence: countBy(rows, (row) => row.previousRuleDivergence),
    currentRuleDivergence: countBy(rows, (row) => row.currentRuleDivergence),
    statusChangedByCurrentRule: rows.filter(
      (row) => row.previousRuleStatus !== row.currentRuleStatus
    ).length,
  };
  const listed = hasFlag("all") ? rows : divergent;

  if (hasFlag("json")) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ summary, rows: listed }, null, 2));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  // eslint-disable-next-line no-console
  console.table(
    listed.map((row) => ({
      pedido: row.orderCode,
      emissao: row.issueDate,
      liquido: row.totalNetValue,
      nfCabecalho: row.nfeHeaderTotalValue,
      nfCompartilhada: row.hasNfeSharedAcrossOrders,
      regraAnterior: row.previousRuleStatus,
      regraAtual: row.currentRuleStatus,
      fluxoFaturado: row.flowProgressInvoiced,
      fluxoEstagio: row.flowStage,
      divergenciaAnterior: row.previousRuleDivergence,
      divergenciaAtual: row.currentRuleDivergence,
    }))
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

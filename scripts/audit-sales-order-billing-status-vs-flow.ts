/**
 * Auditoria READ-ONLY (shadow mode) — status de Faturamento dos Pedidos de Venda.
 *
 * Compara, por pedido:
 *   - legacyStatus: regra por valor (cabeçalho das NF válidas × valor líquido);
 *   - itemizedCoverage: cobertura da obrigação ativa por item
 *     (`SalesOrderItemFlowSnapshot`): FULL / PARTIAL / NONE / UNKNOWN;
 *   - finalStatus: status canônico de `loadSalesOrderLinkedNfeContextMap`;
 *   - decisionReason / usedFallback: por que o status final é esse;
 *   - progressInvoiced / currentStage do `SalesOrderFlowSnapshot` (referência).
 *
 * Só executa SELECT (findMany / groupBy). Não grava, não recalcula snapshot.
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
 *   --all           lista todos os pedidos (padrão: só os que pedem atenção)
 *   --json          saída JSON (resumo + linhas)
 *
 * Linhas listadas por padrão: status final diferente do legado, status final
 * diferente do motor operacional, ou conflito valor × item.
 */
import "dotenv/config";
import { decimalToNumber } from "../src/lib/executiveDashboardHelpers.ts";
import { prisma } from "../src/lib/prisma.ts";
import { loadSalesOrderLinkedNfeContextMap } from "../src/lib/salesOrderLinkedNfe.ts";
import {
  resolveSalesOrderBillingStatus,
  resolveSalesOrderBillingStatusFromContext,
  type SalesOrderBillingStatus,
} from "../src/lib/sales/salesOrderListBillingStatus.ts";

const BATCH_SIZE = 500;
const DEFAULT_WINDOW_DAYS = 365;
/** Progresso agregado do fluxo tratado como 100% (Decimal(10, 2)). */
const FLOW_PROGRESS_FULL = 99.99;

type FlowDivergence =
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
  hasValidNfe: boolean;
  hasNfeSharedAcrossOrders: boolean;
  legacyStatus: SalesOrderBillingStatus;
  itemizedCoverage: string;
  finalStatus: SalesOrderBillingStatus;
  decisionReason: string;
  usedFallback: boolean;
  progressInvoiced: number | null;
  currentStage: string | null;
  legacyVsFlow: FlowDivergence;
  finalVsFlow: FlowDivergence;
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

function isOrderCanceled(status: string | null): boolean {
  return (status ?? "").trim().toUpperCase() === "CANCELLED";
}

function flowStatusFromProgress(
  orderStatus: string | null,
  progressInvoiced: number | null
): SalesOrderBillingStatus | null {
  if (isOrderCanceled(orderStatus)) return "CANCELED";
  if (progressInvoiced == null) return null;
  if (progressInvoiced >= FLOW_PROGRESS_FULL) return "INVOICED";
  if (progressInvoiced > 0) return "PARTIALLY_INVOICED";
  return "NOT_INVOICED";
}

function compareWithFlow(
  gridStatus: SalesOrderBillingStatus,
  flowStatus: SalesOrderBillingStatus | null
): FlowDivergence {
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

function needsAttention(row: AuditRow): boolean {
  return (
    row.legacyStatus !== row.finalStatus ||
    (row.finalVsFlow !== "OK" && row.finalVsFlow !== "NO_FLOW_SNAPSHOT") ||
    row.decisionReason === "LEGACY_VALUE_FULL_OVER_ITEMIZED_PARTIAL"
  );
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
      const hasValidNfe = ctx?.hasNfe ?? false;
      const legacyStatus = resolveSalesOrderBillingStatus({
        status: order.status,
        hasNfe: hasValidNfe,
        isFullyInvoiced: ctx?.legacyIsFullyInvoiced ?? false,
        isPartiallyInvoiced: ctx?.legacyIsPartiallyInvoiced ?? false,
      });
      const finalStatus = resolveSalesOrderBillingStatusFromContext(order.status, ctx);
      const snapshot = snapshotByOrderId.get(order.id) ?? null;
      const progressInvoiced = snapshot ? decimalToNumber(snapshot.progressInvoiced) : null;
      const flowStatus = flowStatusFromProgress(order.status, progressInvoiced);
      rows.push({
        orderCode: order.orderCode,
        salesOrderId: order.id,
        issueDate: order.issueDate ? order.issueDate.toISOString().slice(0, 10) : null,
        totalNetValue: decimalToNumber(order.totalNetValue),
        nfeHeaderTotalValue: ctx?.nfeTotalValue ?? 0,
        hasValidNfe,
        hasNfeSharedAcrossOrders: ctx?.hasNfeSharedAcrossOrders ?? false,
        legacyStatus,
        itemizedCoverage: ctx?.itemizedBillingCoverage ?? "UNKNOWN",
        finalStatus,
        decisionReason: isOrderCanceled(order.status)
          ? "ORDER_CANCELED"
          : (ctx?.billingDecisionReason ?? "NO_VALID_NFE"),
        usedFallback: ctx?.billingUsedLegacyFallback ?? true,
        progressInvoiced,
        currentStage: snapshot?.currentStage ?? null,
        legacyVsFlow: compareWithFlow(legacyStatus, flowStatus),
        finalVsFlow: compareWithFlow(finalStatus, flowStatus),
      });
    }
    if (orders.length < BATCH_SIZE) break;
  }

  const summary = {
    scope: orderFilter
      ? { order: orderFilter }
      : { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    ordersAudited: rows.length,
    ordersWithSharedNfe: rows.filter((row) => row.hasNfeSharedAcrossOrders).length,
    statusChangedFromLegacy: rows.filter((row) => row.legacyStatus !== row.finalStatus).length,
    statusTransitions: countBy(
      rows.filter((row) => row.legacyStatus !== row.finalStatus),
      (row) => `${row.legacyStatus} -> ${row.finalStatus}`
    ),
    decisionReason: countBy(rows, (row) => row.decisionReason),
    itemizedCoverage: countBy(rows, (row) => row.itemizedCoverage),
    legacyVsFlow: countBy(rows, (row) => row.legacyVsFlow),
    finalVsFlow: countBy(rows, (row) => row.finalVsFlow),
  };
  const listed = hasFlag("all") ? rows : rows.filter(needsAttention);

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
      legacyStatus: row.legacyStatus,
      itemizedCoverage: row.itemizedCoverage,
      finalStatus: row.finalStatus,
      progressInvoiced: row.progressInvoiced,
      currentStage: row.currentStage,
      hasValidNfe: row.hasValidNfe,
      usedFallback: row.usedFallback,
      decisionReason: row.decisionReason,
      liquido: row.totalNetValue,
      nfCabecalho: row.nfeHeaderTotalValue,
      nfCompartilhada: row.hasNfeSharedAcrossOrders,
      finalVsFlow: row.finalVsFlow,
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

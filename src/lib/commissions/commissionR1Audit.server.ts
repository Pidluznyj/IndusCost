/**
 * Auditoria R1 — leitura Prisma em lotes de pedidos. SOMENTE LEITURA (`findMany`).
 *
 * Usa o singleton `prisma`: o script instala nele o cliente da transação READ ONLY já
 * envolvido pela trava (createCommission360ReadOnlyPrisma) antes de importar este módulo.
 * Regras em commissionR1Audit.ts.
 */
import { prisma } from "@/src/lib/prisma.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { decimalToNumber } from "./commission-money.js";
import { projectCommissionPortfolioOutlookLines } from "./commissionPortfolioOutlook.js";
import { loadCommissionPortfolioOutlookFacts } from "./commissionPortfolioOutlook.server.js";
import { commissionActiveSnapshotWhere } from "./commissionScheduleVigency.js";
import type { R1OrderInput, R1SellerBatchInput } from "./commissionR1Audit.js";

const ID_CHUNK = 2000;

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function civil(value: Date | null | undefined): string | null {
  return value ? toCivilDateKey(value) : null;
}

function numberOrNull(value: { toString(): string } | number | null | undefined): number | null {
  return value == null ? null : Number(value);
}

/**
 * População: pedidos com ao menos um schedule ACTIVE de snapshot ACTIVE (onde há comissão
 * alocada que o fechamento e a previsão usam). Filtro opcional por código do pedido.
 */
export async function listR1CandidateOrderIds(filter: { orderCode?: string | null } = {}): Promise<string[]> {
  const rows = await prisma.commissionReceivableSchedule.findMany({
    where: {
      status: "ACTIVE",
      ...commissionActiveSnapshotWhere(),
      ...(filter.orderCode ? { salesOrder: { orderCode: filter.orderCode } } : {}),
    },
    select: { salesOrderId: true },
    distinct: ["salesOrderId"],
    orderBy: { salesOrderId: "asc" },
  });
  return [...new Set(rows.map((row) => row.salesOrderId))];
}

/** Lotes PAID por vendedor: só para apontar "pagamento não atribuível ao PV" (nunca para somar). */
export async function loadR1SellerBatches(): Promise<R1SellerBatchInput[]> {
  const rows = await prisma.commissionPaymentBatch.findMany({
    where: { status: "PAID" },
    select: { id: true, commissionPersonId: true, periodStart: true, periodEnd: true },
  });
  return rows.map((row) => ({
    batchId: row.id,
    commissionPersonId: row.commissionPersonId,
    periodStart: civil(row.periodStart) ?? "",
    periodEnd: civil(row.periodEnd) ?? "",
  }));
}

/** Carrega um lote de pedidos (até algumas centenas) com todos os elos da auditoria. */
export async function loadR1OrderInputs(orderIds: readonly string[], today: string): Promise<R1OrderInput[]> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return [];
  const [orders, snapshots, links, flows, schedules] = await Promise.all([
    prisma.salesOrder.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderCode: true, status: true, Customer: { select: { companyName: true, tradeName: true } } },
    }),
    prisma.commissionOrderSnapshot.findMany({
      where: { salesOrderId: { in: ids } },
      select: {
        id: true,
        status: true,
        salesOrderId: true,
        nfeId: true,
        totalFinalCommissionAmount: true,
        saleDate: true,
        canonicalSellerId: true,
        canonicalSellerName: true,
        rawSellerId: true,
        customerNameSnapshot: true,
        items: {
          select: {
            salesOrderItemId: true,
            productNameSnapshot: true,
            finalCommissionAmount: true,
            commissionRatePercent: true,
            marginPercent: true,
            status: true,
          },
        },
      },
    }),
    prisma.salesOrderNfeLink.findMany({
      where: { salesOrderId: { in: ids } },
      select: { salesOrderId: true, nfeExternalId: true, nfeNumber: true, nfeStatus: true },
    }),
    prisma.salesOrderItemFlowSnapshot.findMany({
      where: { salesOrderId: { in: ids } },
      select: {
        salesOrderId: true,
        salesOrderItemId: true,
        orderedQuantity: true,
        shipTargetQuantity: true,
        invoicedQuantity: true,
        requiresProduction: true,
      },
    }),
    prisma.commissionReceivableSchedule.findMany({
      where: { salesOrderId: { in: ids } },
      select: {
        id: true,
        status: true,
        salesOrderId: true,
        receivableId: true,
        nfeId: true,
        orderSnapshotId: true,
        receivableNominalAmount: true,
        scheduledCommissionAmount: true,
        orderSnapshot: { select: { status: true } },
      },
    }),
  ]);

  const nfeIds = [...new Set(links.map((link) => link.nfeExternalId))];
  const nomusStatus = new Map<number, number | null>();
  for (const part of chunk(nfeIds, ID_CHUNK)) {
    const rows = await prisma.nomusNfe.findMany({ where: { externalId: { in: part } }, select: { externalId: true, status: true } });
    for (const row of rows) nomusStatus.set(row.externalId, row.status);
  }

  // Linhas oficiais da Previsão (todas as versões; a projeção anula o que não conta).
  const { facts } = await loadCommissionPortfolioOutlookFacts({ salesOrderId: { in: ids } }, { includeSupersededSnapshots: true });
  const lineBySchedule = new Map(projectCommissionPortfolioOutlookLines(facts, today).map((line) => [line.scheduleId, line]));

  const receivableIds = [...new Set(schedules.map((row) => row.receivableId))];
  const releases: Array<{ id: string; nomusReceivableId: number | null; closingId: string | null; year: number; month: number; releasedCommissionAmount: unknown; commissionRecordId: string | null }> = [];
  for (const part of chunk(receivableIds, ID_CHUNK)) {
    releases.push(
      ...(await prisma.commissionReceiptLedgerLine.findMany({
        where: { nomusReceivableId: { in: part }, closing: { status: "CLOSED" } },
        select: { id: true, nomusReceivableId: true, closingId: true, year: true, month: true, releasedCommissionAmount: true, commissionRecordId: true },
      }))
    );
  }
  const recordIds = [...new Set(releases.map((row) => row.commissionRecordId).filter((id): id is string => Boolean(id)))];
  const paymentItems = new Map<string, { id: string; batchId: string; amountPaid: unknown; commissionRecordId: string; batch: { paymentDate: Date | null }; commissionPaymentSchedule: { nomusReceivableId: number | null } | null }>();
  const paymentFilters = [
    ...chunk(receivableIds, ID_CHUNK).map((part) => ({ commissionPaymentSchedule: { nomusReceivableId: { in: part } } })),
    ...chunk(recordIds, ID_CHUNK).map((part) => ({ commissionRecordId: { in: part } })),
  ];
  for (const filter of paymentFilters) {
    const rows = await prisma.commissionPaymentBatchItem.findMany({
      where: { status: "PAID", batch: { status: "PAID" }, ...filter },
      select: {
        id: true,
        batchId: true,
        amountPaid: true,
        commissionRecordId: true,
        batch: { select: { paymentDate: true } },
        commissionPaymentSchedule: { select: { nomusReceivableId: true } },
      },
    });
    for (const row of rows) paymentItems.set(row.id, row);
  }

  const byOrder = <T extends { salesOrderId: string }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.salesOrderId) ?? [];
      list.push(row);
      map.set(row.salesOrderId, list);
    }
    return map;
  };
  const snapshotsByOrder = byOrder(snapshots);
  const linksByOrder = byOrder(links);
  const flowsByOrder = byOrder(flows);
  const schedulesByOrder = byOrder(schedules);

  return orders.map((order) => {
    const orderSchedules = schedulesByOrder.get(order.id) ?? [];
    const titleIds = new Set(orderSchedules.map((row) => row.receivableId));
    const orderReleases = releases.filter((row) => row.nomusReceivableId != null && titleIds.has(row.nomusReceivableId) && row.closingId);
    const orderRecordIds = new Set(orderReleases.map((row) => row.commissionRecordId).filter(Boolean));
    const snaps = snapshotsByOrder.get(order.id) ?? [];
    return {
      salesOrderId: order.id,
      orderCode: order.orderCode,
      orderStatus: order.status,
      customerName: snaps.find((snap) => snap.status === "ACTIVE")?.customerNameSnapshot ?? order.Customer?.tradeName ?? order.Customer?.companyName ?? null,
      nfes: [...new Map((linksByOrder.get(order.id) ?? []).map((link) => [link.nfeExternalId, link])).values()].map((link) => ({
        nfeId: link.nfeExternalId,
        number: link.nfeNumber,
        // Mesma prioridade do motor (commission-source-resolver): status da NomusNfe, senão o do vínculo.
        status: nomusStatus.get(link.nfeExternalId) ?? link.nfeStatus,
      })),
      snapshots: snaps.map((snap) => ({
        id: snap.id,
        status: snap.status,
        nfeId: snap.nfeId,
        totalFinalCommissionAmount: decimalToNumber(snap.totalFinalCommissionAmount),
        saleDate: civil(snap.saleDate),
        canonicalSellerId: snap.canonicalSellerId,
        canonicalSellerName: snap.canonicalSellerName,
        rawSellerId: snap.rawSellerId,
        items: snap.items.map((item) => ({
          salesOrderItemId: item.salesOrderItemId,
          productName: item.productNameSnapshot,
          finalCommissionAmount: decimalToNumber(item.finalCommissionAmount),
          commissionRatePercent: decimalToNumber(item.commissionRatePercent),
          marginPercent: numberOrNull(item.marginPercent),
          status: item.status,
        })),
      })),
      flows: (flowsByOrder.get(order.id) ?? []).map((flow) => ({
        salesOrderItemId: flow.salesOrderItemId,
        orderedQuantity: numberOrNull(flow.orderedQuantity),
        shipTargetQuantity: Number(flow.shipTargetQuantity),
        invoicedQuantity: Number(flow.invoicedQuantity),
        requiresProduction: flow.requiresProduction,
      })),
      titles: orderSchedules.map((row) => {
        const line = lineBySchedule.get(row.id);
        return {
          scheduleId: row.id,
          scheduleStatus: row.status,
          snapshotId: row.orderSnapshotId,
          snapshotStatus: row.orderSnapshot.status,
          receivableId: row.receivableId,
          nfeId: row.nfeId,
          nominalAmount: decimalToNumber(row.receivableNominalAmount),
          dueDate: line?.dueDate ?? null,
          scheduledCommissionAmount: decimalToNumber(row.scheduledCommissionAmount),
          validInOutlook: line != null && line.status !== "CANCELADA",
          outlookAllocated: line?.allocatedCommission ?? 0,
          realizedCommission: line?.realizedCommission ?? 0,
        };
      }),
      releases: orderReleases.map((row) => ({
        lineId: row.id,
        receivableId: row.nomusReceivableId!,
        closingId: row.closingId!,
        competence: `${row.year}-${String(row.month).padStart(2, "0")}`,
        releasedCommissionAmount: decimalToNumber(row.releasedCommissionAmount as number),
        commissionRecordId: row.commissionRecordId,
      })),
      payments: [...paymentItems.values()]
        .filter(
          (item) =>
            (item.commissionPaymentSchedule?.nomusReceivableId != null && titleIds.has(item.commissionPaymentSchedule.nomusReceivableId)) ||
            orderRecordIds.has(item.commissionRecordId)
        )
        .map((item) => ({
          itemId: item.id,
          batchId: item.batchId,
          paymentDate: civil(item.batch.paymentDate),
          amountPaid: decimalToNumber(item.amountPaid as number),
          receivableId:
            item.commissionPaymentSchedule?.nomusReceivableId != null && titleIds.has(item.commissionPaymentSchedule.nomusReceivableId)
              ? item.commissionPaymentSchedule.nomusReceivableId
              : null,
          commissionRecordId: item.commissionRecordId,
        })),
    };
  });
}

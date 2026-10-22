/**
 * Visão 360° de Comissões — leitura Prisma. SOMENTE LEITURA.
 *
 * As únicas operações no banco são `findMany` (aqui e no loader oficial da Previsão,
 * loadCommissionPortfolioOutlookFacts, e no carregamento das Exceções por cliente).
 * Não chama materialização, scheduler, fechamento, cobertura, reprocesso, pagamento
 * nem sincronização. As regras estão em commission360View.ts (puro).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { isNomusSourceOperationallyPresent } from "@/src/lib/nomus/nomusSourcePresencePolicy.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { applyCommissionPaymentBatchScope } from "./commissionAccessScope.js";
import { decimalToNumber } from "./commission-money.js";
import { resolveCustomerExclusionForSale } from "./commissionCustomerExclusionApply.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import { isCommissionInternalGroupReceivable } from "./commissionInternalGroupExclusion.js";
import { projectCommissionPortfolioOutlookLines } from "./commissionPortfolioOutlook.js";
import { loadCommissionPortfolioOutlookFacts, resolveOutlookOpenBalance } from "./commissionPortfolioOutlook.server.js";
import { commissionActiveSnapshotWhere } from "./commissionScheduleVigency.js";
import { COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH } from "./commissionCoverageCutover.js";
import {
  addCommission360Months,
  buildCommission360ReceivablesCsv,
  buildCommission360View,
  classifyCommission360Receivable,
  filterCommission360ReceivableRows,
  parseCommission360Query,
  type Commission360BatchInput,
  type Commission360Facts,
  type Commission360LedgerLineInput,
  type Commission360LegacyCoverageInput,
  type Commission360OrderAllocation,
  type Commission360PotentialOrderInput,
  type Commission360Query,
  type Commission360ReceivableInput,
  type Commission360SnapshotRef,
} from "./commission360View.js";
import { COMMISSION_360_DIAGNOSTIC_MONTHS, type Commission360Payload } from "./commission360View.shared.js";

const CHUNK = 2000;

/**
 * Alocação do PV inteiro (todas as NF-e): comissão do pedido pelos itens dos snapshots ACTIVE
 * (cada item uma vez; itens com valores diferentes entre snapshots → comissão desconhecida)
 * e Σ dos schedules ACTIVE de snapshot ACTIVE. Mostra o excesso do motor (R1) sem corrigi-lo.
 */
export async function loadCommission360OrderAllocations(orderIds: readonly string[]): Promise<Map<string, Commission360OrderAllocation>> {
  const out = new Map<string, Commission360OrderAllocation>();
  for (const ids of chunk([...new Set(orderIds)])) {
    const [schedules, snapshots] = await Promise.all([
      prisma.commissionReceivableSchedule.findMany({
        where: { salesOrderId: { in: ids }, status: "ACTIVE", ...commissionActiveSnapshotWhere() },
        select: { salesOrderId: true, scheduledCommissionAmount: true },
      }),
      prisma.commissionOrderSnapshot.findMany({
        where: { salesOrderId: { in: ids }, status: "ACTIVE" },
        select: { salesOrderId: true, items: { select: { salesOrderItemId: true, finalCommissionAmount: true } } },
      }),
    ]);
    const itemValues = new Map<string, Map<string, Set<number>>>();
    const snapshotCount = new Map<string, number>();
    for (const snap of snapshots) {
      snapshotCount.set(snap.salesOrderId, (snapshotCount.get(snap.salesOrderId) ?? 0) + 1);
      const byItem = itemValues.get(snap.salesOrderId) ?? new Map<string, Set<number>>();
      for (const item of snap.items) {
        const values = byItem.get(item.salesOrderItemId) ?? new Set<number>();
        values.add(Math.round(decimalToNumber(item.finalCommissionAmount) * 100) / 100);
        byItem.set(item.salesOrderItemId, values);
      }
      itemValues.set(snap.salesOrderId, byItem);
    }
    for (const id of ids) {
      const byItem = itemValues.get(id);
      let orderCommission: number | null = byItem ? 0 : null;
      for (const values of byItem?.values() ?? []) {
        if (values.size !== 1 || orderCommission == null) {
          orderCommission = null;
          break;
        }
        orderCommission = Math.round((orderCommission + [...values][0]!) * 100) / 100;
      }
      out.set(id, { orderCommission, scheduledTotal: 0, activeSnapshotCount: snapshotCount.get(id) ?? 0 });
    }
    for (const row of schedules) {
      const current = out.get(row.salesOrderId);
      if (current) current.scheduledTotal = Math.round((current.scheduledTotal + decimalToNumber(row.scheduledCommissionAmount)) * 100) / 100;
    }
  }
  return out;
}

function chunk<T>(values: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function civil(value: Date | null | undefined): string | null {
  return value ? toCivilDateKey(value) : null;
}

function monthStart(month: string): Date {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
}

/** Mesmo escopo de vendedor da aba Previsão (sellerWhere em commissionPortfolioOutlook.server). */
function scheduleScopeWhere(scope: CommissionAccessScope): Prisma.CommissionReceivableScheduleWhereInput {
  if (scope.dataScope !== "own") return {};
  if (scope.nomusSellerId == null) return { id: { in: [] } };
  return {
    OR: [
      { orderSnapshot: { rawSellerId: scope.nomusSellerId } },
      { canonicalSeller: { nomusPersonId: scope.nomusSellerId, type: "SELLER" } },
      { salesOrder: { externalSellerId: scope.nomusSellerId } },
    ],
  };
}

function ledgerScopeWhere(scope: CommissionAccessScope): Prisma.CommissionReceiptLedgerLineWhereInput {
  if (scope.dataScope !== "own") return {};
  if (scope.nomusSellerId == null) return { id: { in: [] } };
  return {
    OR: [
      { rawSellerId: scope.nomusSellerId },
      { canonicalSeller: { nomusPersonId: scope.nomusSellerId, type: "SELLER" } },
    ],
  };
}

async function loadOutlookLines(scope: CommissionAccessScope, today: string) {
  // Loader e projeção OFICIAIS da Previsão, sem nenhuma alteração de regra.
  const { facts } = await loadCommissionPortfolioOutlookFacts(scheduleScopeWhere(scope));
  return projectCommissionPortfolioOutlookLines(facts, today);
}

async function loadPaidBatches(scope: CommissionAccessScope): Promise<Commission360BatchInput[]> {
  const rows = await prisma.commissionPaymentBatch.findMany({
    where: { status: "PAID", ...applyCommissionPaymentBatchScope(scope) },
    select: {
      id: true,
      status: true,
      paymentDate: true,
      periodStart: true,
      periodEnd: true,
      commissionPersonId: true,
      totalPaid: true,
      commissionPerson: { select: { name: true } },
      items: {
        select: {
          id: true,
          status: true,
          amountPaid: true,
          commissionRecordId: true,
          commissionPaymentSchedule: { select: { nomusReceivableId: true } },
        },
      },
    },
    orderBy: [{ paymentDate: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    batchId: row.id,
    status: row.status,
    paymentDate: civil(row.paymentDate),
    periodStart: civil(row.periodStart) ?? "",
    periodEnd: civil(row.periodEnd) ?? "",
    commissionPersonId: row.commissionPersonId,
    sellerName: row.commissionPerson.name,
    totalPaid: decimalToNumber(row.totalPaid),
    items: row.items.map((item) => ({
      itemId: item.id,
      status: item.status,
      amountPaid: decimalToNumber(item.amountPaid),
      receivableId: item.commissionPaymentSchedule?.nomusReceivableId ?? null,
      commissionRecordId: item.commissionRecordId,
    })),
  }));
}

async function loadLegacyCoverages(query: Commission360Query): Promise<Commission360LegacyCoverageInput[]> {
  const fromYear = Number(query.fromMonth.slice(0, 4));
  const toYear = Number(query.toMonth.slice(0, 4));
  const rows = await prisma.commissionReceiptCoverage.findMany({
    where: {
      coverageSource: "NOMUS_LEGACY",
      coverageStatus: "COVERED",
      coveredYear: { gte: fromYear, lte: toYear },
    },
    select: {
      id: true,
      coverageSource: true,
      coverageStatus: true,
      receiptExternalId: true,
      receivableExternalId: true,
      coveredYear: true,
      coveredMonth: true,
      coveredCommissionAmount: true,
      legacyImportId: true,
    },
    orderBy: [{ coveredYear: "asc" }, { coveredMonth: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    coverageId: row.id,
    coverageSource: row.coverageSource,
    coverageStatus: row.coverageStatus,
    receiptExternalId: row.receiptExternalId,
    receivableId: row.receivableExternalId,
    coveredYear: row.coveredYear,
    coveredMonth: row.coveredMonth,
    coveredCommissionAmount: row.coveredCommissionAmount == null ? null : decimalToNumber(row.coveredCommissionAmount),
    legacyImportId: row.legacyImportId,
  }));
}

async function loadClosedLedgerLines(scope: CommissionAccessScope): Promise<Commission360LedgerLineInput[]> {
  const rows = await prisma.commissionReceiptLedgerLine.findMany({
    where: {
      ...ledgerScopeWhere(scope),
      closing: { status: "CLOSED" },
      year: { gte: COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH.year },
      releasedCommissionAmount: { gt: 0 },
    },
    select: {
      id: true,
      closingId: true,
      year: true,
      month: true,
      canonicalSellerId: true,
      canonicalSellerName: true,
      rawSellerId: true,
      rawSellerName: true,
      releasedCommissionAmount: true,
      commissionRecordId: true,
      inclusionType: true,
      naturalYear: true,
      naturalMonth: true,
      closing: { select: { status: true } },
    },
  });
  return rows
    .filter((row) => row.closingId != null && row.closing != null)
    .map((row) => ({
      lineId: row.id,
      closingId: row.closingId!,
      closingStatus: row.closing!.status,
      year: row.year,
      month: row.month,
      canonicalSellerId: row.canonicalSellerId,
      rawSellerId: row.rawSellerId,
      sellerName: row.canonicalSellerName ?? row.rawSellerName ?? "Sem vendedor",
      releasedCommissionAmount: decimalToNumber(row.releasedCommissionAmount),
      commissionRecordId: row.commissionRecordId,
      inclusionType: row.inclusionType,
      naturalYear: row.naturalYear,
      naturalMonth: row.naturalMonth,
    }));
}

/**
 * Carteira ativa: pedidos com algum item de fluxo oficial ativo ainda não 100% faturado.
 * Depois carrega TODOS os itens desses pedidos (comissão total, faturada e pendente do pedido).
 * A quantidade exata pendente é decidida na regra pura (shipTarget − faturado).
 */
async function loadPotentialOrders(scope: CommissionAccessScope): Promise<Commission360PotentialOrderInput[]> {
  if (scope.dataScope === "own" && scope.nomusSellerId == null) return [];
  const pendingItems = await prisma.salesOrderItemFlowSnapshot.findMany({
    where: {
      isActiveForKanban: true,
      progressInvoiced: { lt: 100 },
      salesOrder: {
        status: { not: "CANCELLED" },
        ...(scope.dataScope === "own" ? { externalSellerId: scope.nomusSellerId } : {}),
      },
    },
    select: { salesOrderId: true },
  });
  const orderIds = [...new Set(pendingItems.map((row) => row.salesOrderId))];
  if (orderIds.length === 0) return [];
  const flows: Array<{
    salesOrderId: string;
    salesOrderItemId: string;
    orderedQuantity: Prisma.Decimal | null;
    shipTargetQuantity: Prisma.Decimal;
    invoicedQuantity: Prisma.Decimal;
  }> = [];
  for (const ids of chunk(orderIds)) {
    flows.push(
      ...(await prisma.salesOrderItemFlowSnapshot.findMany({
        where: {
          salesOrderId: { in: ids },
          isActiveForKanban: true,
          ...(scope.dataScope === "own" ? { salesOrder: { externalSellerId: scope.nomusSellerId } } : {}),
        },
        select: {
          salesOrderId: true,
          salesOrderItemId: true,
          orderedQuantity: true,
          shipTargetQuantity: true,
          invoicedQuantity: true,
        },
      }))
    );
  }
  const rulesPromise = loadActiveCustomerExclusionRuleSnapshots();
  const orders: Array<{ id: string; orderCode: string; status: string; externalSellerId: number | null; issueDate: Date }> = [];
  const snapshots: Array<{
    id: string;
    salesOrderId: string;
    saleDate: Date;
    customerId: string;
    customerNameSnapshot: string;
    canonicalSellerId: string | null;
    canonicalSellerName: string | null;
    rawSellerId: number | null;
    sellerResolutionStatus: string | null;
    customer: { taxId: string | null; nomusExternalPersonId: number | null } | null;
    items: Array<{ salesOrderItemId: string; finalCommissionAmount: Prisma.Decimal; status: string; productNameSnapshot: string }>;
  }> = [];
  for (const ids of chunk(orderIds)) {
    const [orderRows, snapshotRows] = await Promise.all([
      prisma.salesOrder.findMany({
        where: { id: { in: ids } },
        select: { id: true, orderCode: true, status: true, externalSellerId: true, issueDate: true },
      }),
      prisma.commissionOrderSnapshot.findMany({
        where: { salesOrderId: { in: ids }, status: "ACTIVE" },
        select: {
          id: true,
          salesOrderId: true,
          saleDate: true,
          customerId: true,
          customerNameSnapshot: true,
          canonicalSellerId: true,
          canonicalSellerName: true,
          rawSellerId: true,
          sellerResolutionStatus: true,
          customer: { select: { taxId: true, nomusExternalPersonId: true } },
          items: { select: { salesOrderItemId: true, finalCommissionAmount: true, status: true, productNameSnapshot: true } },
        },
        orderBy: [{ createdAt: "desc" }],
      }),
    ]);
    orders.push(...orderRows);
    snapshots.push(...snapshotRows);
  }
  const [rules, allocations] = await Promise.all([rulesPromise, loadCommission360OrderAllocations(orderIds)]);
  const flowsByOrder = new Map<string, typeof flows>();
  for (const flow of flows) {
    const list = flowsByOrder.get(flow.salesOrderId) ?? [];
    list.push(flow);
    flowsByOrder.set(flow.salesOrderId, list);
  }
  return orders.map((order) => {
    const ofOrder = snapshots.filter((snap) => snap.salesOrderId === order.id);
    const head = ofOrder[0] ?? null;
    return {
      salesOrderId: order.id,
      orderCode: order.orderCode,
      orderStatus: order.status,
      saleDate: civil(head?.saleDate ?? order.issueDate),
      customerName: head?.customerNameSnapshot ?? "",
      canonicalSellerId: head?.canonicalSellerId ?? null,
      sellerName: head?.canonicalSellerName ?? null,
      rawSellerId: head?.rawSellerId ?? order.externalSellerId,
      sellerResolutionStatus: head?.sellerResolutionStatus ?? null,
      customerExcludedByActiveRule:
        head != null &&
        resolveCustomerExclusionForSale({
          customerId: head.customerId,
          customerExternalId: head.customer?.nomusExternalPersonId ?? null,
          customerTaxId: head.customer?.taxId ?? null,
          customerName: head.customerNameSnapshot,
          referenceDate: head.saleDate,
          rules,
        }) != null,
      hasActiveSnapshot: head != null,
      scheduledCommissionAmount: allocations.get(order.id)?.scheduledTotal ?? 0,
      items: (flowsByOrder.get(order.id) ?? []).map((flow) => {
        const snapItems = ofOrder.flatMap((snap) => snap.items.filter((item) => item.salesOrderItemId === flow.salesOrderItemId));
        return {
          salesOrderItemId: flow.salesOrderItemId,
          productName: snapItems[0]?.productNameSnapshot ?? null,
          snapshotFinalCommissions: snapItems.map((item) => decimalToNumber(item.finalCommissionAmount)),
          snapshotItemStatuses: snapItems.map((item) => item.status),
          flow: {
            orderedQuantity: flow.orderedQuantity == null ? null : Number(flow.orderedQuantity),
            shipTargetQuantity: Number(flow.shipTargetQuantity),
            invoicedQuantity: Number(flow.invoicedQuantity),
          },
        };
      }),
    };
  });
}

/** Janela da conciliação: período pedido + novembro/dezembro de 2026 (diagnóstico prioritário). */
export function resolveCommission360ReconciliationWindow(query: Pick<Commission360Query, "fromMonth" | "toMonth">): {
  fromMonth: string;
  toMonth: string;
} {
  const first = COMMISSION_360_DIAGNOSTIC_MONTHS[0];
  const last = COMMISSION_360_DIAGNOSTIC_MONTHS[COMMISSION_360_DIAGNOSTIC_MONTHS.length - 1]!;
  return {
    fromMonth: query.fromMonth < first ? query.fromMonth : first,
    toMonth: query.toMonth > last ? query.toMonth : last,
  };
}

/**
 * Conciliação inversa: a população começa nos CRs da origem (todos os títulos com
 * vencimento na janela), não nos schedules. Cada elo é carregado em lote.
 */
export async function loadCommission360Receivables(
  window: { fromMonth: string; toMonth: string },
  today: string
): Promise<Commission360ReceivableInput[]> {
  const arRows = await prisma.nomusAccountsReceivable.findMany({
    where: { dueDate: { gte: monthStart(window.fromMonth), lt: monthStart(addCommission360Months(window.toMonth, 1)) } },
    select: {
      externalId: true,
      sourceInvoiceId: true,
      sourceInvoiceNumber: true,
      dueDate: true,
      amountReceivable: true,
      amountReceived: true,
      balanceReceivable: true,
      suspendCollection: true,
      sourcePresenceStatus: true,
      personName: true,
      personCnpj: true,
    },
    orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
  });
  if (arRows.length === 0) return [];
  const receivableIds = arRows.map((row) => row.externalId);
  const nfeIds = [...new Set(arRows.map((row) => row.sourceInvoiceId).filter((id): id is number => id != null))];

  const links: Array<{ nfeExternalId: number; salesOrderId: string; SalesOrder: { orderCode: string; status: string; externalSellerId: number | null } }> = [];
  const siblings: Array<{ externalId: number; sourceInvoiceId: number | null; sourceInvoiceNumber: string | null; dueDate: Date | null; amountReceivable: Prisma.Decimal | null }> = [];
  for (const ids of chunk(nfeIds)) {
    const [linkRows, siblingRows] = await Promise.all([
      prisma.salesOrderNfeLink.findMany({
        where: { nfeExternalId: { in: ids } },
        select: {
          nfeExternalId: true,
          salesOrderId: true,
          SalesOrder: { select: { orderCode: true, status: true, externalSellerId: true } },
        },
      }),
      prisma.nomusAccountsReceivable.findMany({
        where: { sourceInvoiceId: { in: ids } },
        select: { externalId: true, sourceInvoiceId: true, sourceInvoiceNumber: true, dueDate: true, amountReceivable: true },
      }),
    ]);
    links.push(...linkRows);
    siblings.push(...siblingRows);
  }

  const orderIds = [...new Set(links.map((row) => row.salesOrderId))];
  const rulesPromise = loadActiveCustomerExclusionRuleSnapshots();
  const snapshotRows: Array<{
    id: string;
    status: string;
    salesOrderId: string;
    nfeId: number | null;
    sourceHash: string;
    customerId: string;
    createdAt: Date;
    saleDate: Date;
    customerNameSnapshot: string;
    totalFinalCommissionAmount: Prisma.Decimal;
    sellerResolutionStatus: string | null;
    canonicalSellerId: string | null;
    canonicalSellerName: string | null;
    rawSellerId: number | null;
    customer: { taxId: string | null; nomusExternalPersonId: number | null } | null;
    items: Array<{ status: string }>;
  }> = [];
  // Fatiado por NF-e (limite de parâmetros do PostgreSQL); o par pedido/NF-e é conferido na regra pura.
  const linkedOrders = new Set(orderIds);
  for (const ids of chunk(orderIds.length > 0 ? nfeIds : [])) {
    snapshotRows.push(
      ...(await prisma.commissionOrderSnapshot.findMany({
        where: { nfeId: { in: ids } },
        select: {
          id: true,
          status: true,
          salesOrderId: true,
          nfeId: true,
          sourceHash: true,
          customerId: true,
          createdAt: true,
          saleDate: true,
          customerNameSnapshot: true,
          totalFinalCommissionAmount: true,
          sellerResolutionStatus: true,
          canonicalSellerId: true,
          canonicalSellerName: true,
          rawSellerId: true,
          customer: { select: { taxId: true, nomusExternalPersonId: true } },
          items: { select: { status: true } },
        },
      }))
    );
  }

  // Schedules de TODAS as versões (inclusive substituídas): a conciliação precisa ver o
  // schedule órfão; a projeção oficial anula o que não conta.
  // Fatiado por título: a anulação de schedules duplicados do motor agrupa por título.
  const outlookFacts: Awaited<ReturnType<typeof loadCommissionPortfolioOutlookFacts>>["facts"] = [];
  for (const ids of chunk(receivableIds)) {
    const loaded = await loadCommissionPortfolioOutlookFacts({ receivableId: { in: ids } }, { includeSupersededSnapshots: true });
    outlookFacts.push(...loaded.facts);
  }
  const lines = projectCommissionPortfolioOutlookLines(outlookFacts, today);
  const linesByReceivable = new Map<number, typeof lines>();
  for (const line of lines) {
    const list = linesByReceivable.get(line.receivableId) ?? [];
    list.push(line);
    linesByReceivable.set(line.receivableId, list);
  }

  const [rules, orderAllocations] = await Promise.all([rulesPromise, loadCommission360OrderAllocations(orderIds)]);
  const snapshotsByNfe = new Map<number, Commission360SnapshotRef[]>();
  for (const row of snapshotRows) {
    if (row.nfeId == null || !linkedOrders.has(row.salesOrderId)) continue;
    const list = snapshotsByNfe.get(row.nfeId) ?? [];
    list.push({
      id: row.id,
      status: row.status,
      salesOrderId: row.salesOrderId,
      nfeId: row.nfeId,
      sourceHash: row.sourceHash,
      customerId: row.customerId,
      createdAt: row.createdAt.toISOString(),
      totalFinalCommissionAmount: decimalToNumber(row.totalFinalCommissionAmount),
      itemStatuses: row.items.map((item) => item.status),
      sellerResolutionStatus: row.sellerResolutionStatus,
      canonicalSellerId: row.canonicalSellerId,
      canonicalSellerName: row.canonicalSellerName,
      rawSellerId: row.rawSellerId,
      customerExcludedByActiveRule:
        resolveCustomerExclusionForSale({
          customerId: row.customerId,
          customerExternalId: row.customer?.nomusExternalPersonId ?? null,
          customerTaxId: row.customer?.taxId ?? null,
          customerName: row.customerNameSnapshot,
          referenceDate: row.saleDate,
          rules,
        }) != null,
    });
    snapshotsByNfe.set(row.nfeId, list);
  }
  const linksByNfe = new Map<number, typeof links>();
  for (const link of links) {
    const list = linksByNfe.get(link.nfeExternalId) ?? [];
    list.push(link);
    linksByNfe.set(link.nfeExternalId, list);
  }
  const siblingsByNfe = new Map<number, typeof siblings>();
  for (const row of siblings) {
    if (row.sourceInvoiceId == null) continue;
    const list = siblingsByNfe.get(row.sourceInvoiceId) ?? [];
    list.push(row);
    siblingsByNfe.set(row.sourceInvoiceId, list);
  }

  return arRows.map((row) => {
    const amountReceivable = row.amountReceivable == null ? null : decimalToNumber(row.amountReceivable);
    const nfeId = row.sourceInvoiceId;
    return {
      receivableId: row.externalId,
      invoiceNumber: row.sourceInvoiceNumber,
      sourceInvoiceId: nfeId,
      dueDate: civil(row.dueDate),
      customerName: row.personName,
      nominalAmount: amountReceivable ?? 0,
      // Mesma regra de saldo e de universo operacional da Previsão.
      openBalance: isNomusSourceOperationallyPresent(row.sourcePresenceStatus)
        ? resolveOutlookOpenBalance({
            balanceReceivable: row.balanceReceivable == null ? null : decimalToNumber(row.balanceReceivable),
            amountReceivable,
            amountReceived: row.amountReceived == null ? null : decimalToNumber(row.amountReceived),
          })
        : null,
      suspended: row.suspendCollection === true,
      groupCompany: isCommissionInternalGroupReceivable({ customerName: row.personName, customerCnpj: row.personCnpj }),
      orderLinks:
        nfeId == null
          ? []
          : (linksByNfe.get(nfeId) ?? []).map((link) => ({
              salesOrderId: link.salesOrderId,
              orderCode: link.SalesOrder.orderCode,
              status: link.SalesOrder.status,
              externalSellerId: link.SalesOrder.externalSellerId,
            })),
      snapshots: nfeId == null ? [] : snapshotsByNfe.get(nfeId) ?? [],
      nfeReceivables:
        nfeId == null
          ? []
          : (siblingsByNfe.get(nfeId) ?? []).map((sibling) => ({
              receivableId: sibling.externalId,
              nominalAmount: sibling.amountReceivable == null ? 0 : decimalToNumber(sibling.amountReceivable),
              dueDate: civil(sibling.dueDate),
              invoiceNumber: sibling.sourceInvoiceNumber?.trim() || null,
            })),
      outlookLines: linesByReceivable.get(row.externalId) ?? [],
      orderAllocations,
    };
  });
}

export async function loadCommission360Facts(
  query: Commission360Query,
  scope: CommissionAccessScope,
  today: string
): Promise<Commission360Facts> {
  const [outlookLines, batches, legacyCoverages, ledgerLines, potentialOrders, receivables] = await Promise.all([
    loadOutlookLines(scope, today),
    loadPaidBatches(scope),
    loadLegacyCoverages(query),
    loadClosedLedgerLines(scope),
    loadPotentialOrders(scope),
    loadCommission360Receivables(resolveCommission360ReconciliationWindow(query), today),
  ]);
  return { outlookLines, batches, legacyCoverages, ledgerLines, potentialOrders, receivables };
}

function todayKey(): string {
  return toCivilDateKey(new Date()) ?? new Date().toISOString().slice(0, 10);
}

export async function getCommission360View(
  rawQuery: Record<string, unknown>,
  scope: CommissionAccessScope,
  today: string = todayKey()
): Promise<Commission360Payload> {
  const query = parseCommission360Query(rawQuery, scope, today);
  const facts = await loadCommission360Facts(query, scope, today);
  return buildCommission360View(facts, query, today);
}

/** CSV completo (sem paginação) da conciliação de CRs do período e filtros. */
export async function exportCommission360ReceivablesCsv(
  rawQuery: Record<string, unknown>,
  scope: CommissionAccessScope,
  today: string = todayKey()
): Promise<{ csv: string; filename: string }> {
  const query = parseCommission360Query(rawQuery, scope, today);
  const receivables = await loadCommission360Receivables(query, today);
  const inputs = new Map(receivables.map((row) => [row.receivableId, row]));
  const rows = filterCommission360ReceivableRows(receivables.map(classifyCommission360Receivable), inputs, query).filter(
    (row) => (!query.crStatus || row.status === query.crStatus) && row.dueMonth != null && row.dueMonth >= query.fromMonth && row.dueMonth <= query.toMonth
  );
  return {
    csv: `﻿${buildCommission360ReceivablesCsv(rows)}`,
    filename: `comissoes-visao-360-conciliacao-${query.fromMonth}-a-${query.toMonth}.csv`,
  };
}

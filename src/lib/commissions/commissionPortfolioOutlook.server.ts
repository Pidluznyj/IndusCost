/**
 * Leitura da previsão de comissões.
 * Não cria cobertura, não fecha competência e não paga o vendedor.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { decimalToNumber } from "./commission-money.js";
import { isNomusSourceOperationallyPresent } from "@/src/lib/nomus/nomusSourcePresencePolicy.js";
import { commissionActiveSnapshotWhere } from "./commissionScheduleVigency.js";
import { resolveCustomerExclusionForSale } from "./commissionCustomerExclusionApply.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import { isCommissionInternalGroupReceivable } from "./commissionInternalGroupExclusion.js";
import {
  buildCommissionPortfolioOutlook,
  clampOutlookFromMonth,
  type OutlookCoverageSource,
  type OutlookPayload,
  type OutlookQuery,
  type OutlookScheduleInput,
  type OutlookTitleFacts,
} from "./commissionPortfolioOutlook.js";

/**
 * Saldo em aberto do título: o saldo da origem; sem ele, original − recebido.
 * Mesma regra de resolveOpenReceivableBalance do motor de fechamento.
 */
export function resolveOutlookOpenBalance(input: {
  balanceReceivable: number | null;
  amountReceivable: number | null;
  amountReceived: number | null;
}): number {
  if (input.balanceReceivable != null && Number.isFinite(input.balanceReceivable)) {
    return Math.max(0, input.balanceReceivable);
  }
  return Math.max(0, (input.amountReceivable ?? 0) - (input.amountReceived ?? 0));
}

const SCHEDULE_STATUSES = ["ACTIVE", "CUSTOMER_EXCLUDED", "ORPHAN", "ERROR"] as const;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function monthKey(value: unknown): string | null {
  const raw = text(value);
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return null;
  return raw;
}

export function parseCommissionPortfolioOutlookQuery(
  raw: Record<string, unknown>,
  scope: CommissionAccessScope
): OutlookQuery {
  const page = Math.max(1, Number(raw.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(raw.pageSize) || 25));
  return {
    // Previsão só do primeiro mês em diante (setembro/2026); o anterior fica no Nomus.
    fromMonth: clampOutlookFromMonth(monthKey(raw.from)),
    toMonth: monthKey(raw.to),
    canonicalSellerId: scope.dataScope === "own" ? null : text(raw.sellerId),
    customerId: text(raw.customerId),
    orderCode: text(raw.orderCode),
    status: text(raw.status),
    page,
    pageSize,
    ownNomusSellerId: null,
    sellerLocked: scope.dataScope === "own",
  };
}

function sellerWhere(scope: CommissionAccessScope): Prisma.CommissionReceivableScheduleWhereInput {
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

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export async function getCommissionPortfolioOutlook(
  rawQuery: Record<string, unknown>,
  scope: CommissionAccessScope,
  today: string = toCivilDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)
): Promise<OutlookPayload> {
  const query = parseCommissionPortfolioOutlookQuery(rawQuery, scope);
  const where: Prisma.CommissionReceivableScheduleWhereInput = { ...sellerWhere(scope) };
  const and: Prisma.CommissionReceivableScheduleWhereInput[] = [];
  if (query.canonicalSellerId) and.push({ canonicalSellerId: query.canonicalSellerId });
  if (query.customerId) and.push({ customerId: query.customerId });
  if (query.orderCode) {
    and.push({ salesOrder: { orderCode: { contains: query.orderCode, mode: "insensitive" } } });
  }
  if (and.length > 0) where.AND = and;

  const { facts } = await loadCommissionPortfolioOutlookFacts(where);
  return buildCommissionPortfolioOutlook(facts, query, today);
}

/**
 * Carrega os fatos da previsão em lote (sem consulta por título). Somente leitura.
 *
 * Só entram schedules da versão VIGENTE do pedido (snapshot pai ACTIVE), como no
 * fechamento. `includeSupersededSnapshots` existe apenas para a auditoria medir
 * quanto as versões substituídas inflavam a previsão antiga.
 */
export async function loadCommissionPortfolioOutlookFacts(
  scopeWhere: Prisma.CommissionReceivableScheduleWhereInput = {},
  options: { includeSupersededSnapshots?: boolean } = {}
): Promise<{ facts: OutlookScheduleInput[]; titles: Map<number, OutlookTitleFacts> }> {
  const where: Prisma.CommissionReceivableScheduleWhereInput = {
    ...scopeWhere,
    status: { in: [...SCHEDULE_STATUSES] },
    ...(options.includeSupersededSnapshots ? {} : commissionActiveSnapshotWhere()),
  };

  // Regras vivas de Exceções por cliente: valem mesmo para schedule materializado antes da regra.
  const exclusionRulesPromise = loadActiveCustomerExclusionRuleSnapshots();
  const schedules = await prisma.commissionReceivableSchedule.findMany({
    where,
    select: {
      id: true,
      status: true,
      createdAt: true,
      receivableId: true,
      receivableCode: true,
      installmentNumber: true,
      nfeId: true,
      salesOrderId: true,
      customerId: true,
      canonicalSellerId: true,
      receivableNominalAmount: true,
      receivableSharePercent: true,
      scheduledCommissionAmount: true,
      salesOrder: { select: { orderCode: true, externalSellerId: true } },
      customer: { select: { companyName: true, tradeName: true, taxId: true, nomusExternalPersonId: true } },
      canonicalSeller: { select: { name: true } },
      orderSnapshot: {
        select: {
          status: true,
          saleDate: true,
          rawSellerId: true,
          sellerResolutionStatus: true,
          canonicalSellerName: true,
          customerNameSnapshot: true,
        },
      },
    },
    orderBy: [{ receivableId: "asc" }, { installmentNumber: "asc" }],
  });

  const receivableIds = [...new Set(schedules.map((row) => row.receivableId))];
  const titles = new Map<number, OutlookTitleFacts>();
  const receiptsByReceivable = new Map<number, OutlookScheduleInput["receipts"]>();
  const paidByReceivable = new Map<number, number>();

  for (const ids of chunk(receivableIds, 2000)) {
    const [arRows, receiptRows, coverageRows, paymentRows] = await Promise.all([
      prisma.nomusAccountsReceivable.findMany({
        where: { externalId: { in: ids } },
        select: {
          externalId: true,
          dueDate: true,
          settlementDate: true,
          amountReceivable: true,
          balanceReceivable: true,
          amountReceived: true,
          sourceInvoiceNumber: true,
          status: true,
          suspendCollection: true,
          sourcePresenceStatus: true,
          personName: true,
          personCnpj: true,
        },
      }),
      prisma.nomusReceivableReceipt.findMany({
        where: { receivableExternalId: { in: ids } },
        select: {
          externalId: true,
          receivableExternalId: true,
          receiptDate: true,
          receivedAmount: true,
        },
        orderBy: [{ receiptDate: "asc" }, { externalId: "asc" }],
      }),
      prisma.commissionReceiptCoverage.findMany({
        where: { receivableExternalId: { in: ids }, coverageStatus: "COVERED" },
        select: {
          receiptExternalId: true,
          receivableExternalId: true,
          coverageSource: true,
          coveredCommissionAmount: true,
        },
      }),
      prisma.commissionPaymentSchedule.findMany({
        where: { nomusReceivableId: { in: ids } },
        select: {
          nomusReceivableId: true,
          paymentBatchItems: {
            where: { status: "PAID" },
            select: { amountPaid: true },
          },
        },
      }),
    ]);

    for (const row of arRows) {
      const amountReceivable = row.amountReceivable == null ? null : decimalToNumber(row.amountReceivable);
      const amountReceived = row.amountReceived == null ? null : decimalToNumber(row.amountReceived);
      const balanceRaw = row.balanceReceivable == null ? null : decimalToNumber(row.balanceReceivable);
      titles.set(row.externalId, {
        dueDate: toCivilDateKey(row.dueDate),
        // Título removido na origem (ausência confirmada) não tem saldo oficial.
        balance: isNomusSourceOperationallyPresent(row.sourcePresenceStatus)
          ? resolveOutlookOpenBalance({
              balanceReceivable: balanceRaw,
              amountReceivable,
              amountReceived,
            })
          : null,
        balanceRaw,
        amountReceivable,
        amountReceived,
        invoiceNumber: row.sourceInvoiceNumber,
        settlementDate: toCivilDateKey(row.settlementDate),
        // `status` do Nomus indica BAIXA (true = baixado, false = em aberto), não cancelamento:
        // não decide nada aqui. Não há campo de cancelamento no título; o sinal comprovado é o
        // título sumir da origem (MISSING_CONFIRMED), tratado acima como saldo desconhecido.
        cancelled: false,
        nomusStatus: row.status,
        // Cobrança suspensa fica fora, como no fechamento.
        suspended: row.suspendCollection === true,
        sourcePresenceStatus: row.sourcePresenceStatus,
        groupCompany: isCommissionInternalGroupReceivable({ customerName: row.personName, customerCnpj: row.personCnpj }),
      });
    }

    const coverageByReceipt = new Map<number, { source: OutlookCoverageSource; amount: number | null }>();
    for (const row of coverageRows) {
      if (row.receiptExternalId == null) continue;
      if (coverageByReceipt.has(row.receiptExternalId)) continue;
      const source = row.coverageSource;
      if (source !== "NOMUS_LEGACY" && source !== "INDUSCOST_CLOSING" && source !== "MANUAL_ADJUSTMENT") {
        continue;
      }
      coverageByReceipt.set(row.receiptExternalId, {
        source,
        amount: row.coveredCommissionAmount == null ? null : decimalToNumber(row.coveredCommissionAmount),
      });
    }

    for (const row of receiptRows) {
      const list = receiptsByReceivable.get(row.receivableExternalId) ?? [];
      const coverage = coverageByReceipt.get(row.externalId);
      list.push({
        externalId: row.externalId,
        receiptDate: toCivilDateKey(row.receiptDate) ?? "",
        receivedAmount: decimalToNumber(row.receivedAmount),
        coverageSource: coverage?.source ?? null,
        coveredCommissionAmount: coverage?.amount ?? null,
      });
      receiptsByReceivable.set(row.receivableExternalId, list);
    }

    for (const row of paymentRows) {
      if (row.nomusReceivableId == null) continue;
      const paid = row.paymentBatchItems.reduce((sum, item) => sum + decimalToNumber(item.amountPaid), 0);
      paidByReceivable.set(
        row.nomusReceivableId,
        (paidByReceivable.get(row.nomusReceivableId) ?? 0) + paid
      );
    }
  }

  const exclusionRules = await exclusionRulesPromise;
  const facts: OutlookScheduleInput[] = schedules.map((row) => {
    const title = titles.get(row.receivableId);
    return {
      scheduleId: row.id,
      scheduleStatus: row.status,
      orderSnapshotStatus: row.orderSnapshot.status,
      scheduleCreatedAt: row.createdAt.toISOString(),
      titleCancelled: title?.cancelled ?? false,
      titleSuspended: title?.suspended ?? false,
      groupCompany: title?.groupCompany ?? false,
      // Mesma aplicação da Provisão por pedido: regra ativa na data da venda.
      customerExcludedByActiveRule:
        resolveCustomerExclusionForSale({
          customerId: row.customerId,
          customerExternalId: row.customer.nomusExternalPersonId ?? null,
          customerTaxId: row.customer.taxId ?? null,
          customerName: row.orderSnapshot.customerNameSnapshot,
          referenceDate: row.orderSnapshot.saleDate,
          rules: exclusionRules,
        }) != null,
      salesOrderId: row.salesOrderId,
      orderCode: row.salesOrder.orderCode,
      customerId: row.customerId,
      customerName:
        row.orderSnapshot.customerNameSnapshot ||
        row.customer.tradeName ||
        row.customer.companyName,
      canonicalSellerId: row.canonicalSellerId,
      canonicalSellerName:
        row.canonicalSeller?.name ?? row.orderSnapshot.canonicalSellerName ?? null,
      rawSellerId: row.orderSnapshot.rawSellerId ?? row.salesOrder.externalSellerId,
      sellerResolutionStatus: row.orderSnapshot.sellerResolutionStatus,
      nfeNumber: title?.invoiceNumber ?? (row.nfeId != null ? String(row.nfeId) : null),
      receivableId: row.receivableId,
      receivableCode: row.receivableCode,
      installmentNumber: row.installmentNumber,
      dueDate: title?.dueDate ?? null,
      nominalAmount: decimalToNumber(row.receivableNominalAmount),
      allocatedCommission: decimalToNumber(row.scheduledCommissionAmount),
      sharePercent: decimalToNumber(row.receivableSharePercent),
      balanceReceivable: title?.balance ?? null,
      amountReceivedOnTitle: title?.amountReceived ?? null,
      paidToSellerAmount: paidByReceivable.get(row.receivableId) ?? 0,
      receipts: (receiptsByReceivable.get(row.receivableId) ?? []).filter((receipt) => receipt.receiptDate),
    };
  });

  return { facts, titles };
}

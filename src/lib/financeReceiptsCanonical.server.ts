/**
 * Camada canônica NEUTRA de recebimentos financeiros — acesso a dados
 * (Prisma). Companion de `financeReceiptsCanonical.ts` (lógica pura).
 *
 * Ponto ÚNICO de leitura de `NomusReceivableReceipt` para consumidores fora
 * de Comissões. Nenhum consumidor deve montar `findMany`/`groupBy` direto
 * contra essa tabela fora daqui — repetir a query é repetir a regra.
 *
 * Todas as consultas por lote (nunca uma query por título — N+1).
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import {
  detectSettledWithoutReceipt,
  groupReceiptEventsByReceivable,
  sumReceivedAmountForEvents,
  type FinanceReceiptEvent,
  type FinanceReceiptsFreshness,
  type FinanceReceivableSettlementInconsistency,
} from "./financeReceiptsCanonical.js";

export type FinanceReceiptsDb = Pick<PrismaClient, "nomusReceivableReceipt">;
export type FinanceReceiptsWithArDb = Pick<
  PrismaClient,
  "nomusReceivableReceipt" | "nomusAccountsReceivable"
>;

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

const RECEIPT_EVENT_SELECT = {
  externalId: true,
  receivableExternalId: true,
  receiptDate: true,
  receivedAmount: true,
  bankFeeAmount: true,
  lateFeeInterestAmount: true,
  discountAmount: true,
  closesReceivable: true,
} as const;

type ReceiptEventRow = {
  externalId: number;
  receivableExternalId: number;
  receiptDate: Date;
  receivedAmount: Prisma.Decimal;
  bankFeeAmount: Prisma.Decimal | null;
  lateFeeInterestAmount: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal | null;
  closesReceivable: boolean | null;
};

function mapReceiptEventRow(row: ReceiptEventRow): FinanceReceiptEvent {
  return {
    receiptExternalId: row.externalId,
    receivableExternalId: row.receivableExternalId,
    receiptDate: row.receiptDate,
    receivedAmount: decimalToNumber(row.receivedAmount),
    bankFeeAmount: decimalToNumber(row.bankFeeAmount),
    lateFeeInterestAmount: decimalToNumber(row.lateFeeInterestAmount),
    discountAmount: decimalToNumber(row.discountAmount),
    closesReceivable: row.closesReceivable,
  };
}

/**
 * Primitiva 1 — eventos reais de recebimento de um período (`receiptDate`
 * dentro de `[from, to]`, inclusive). População opcional: restringe aos
 * títulos elegíveis informados (mesma população/exclusões do indicador que
 * está chamando — a camada canônica nunca decide sozinha quais títulos
 * "contam", quem chama é quem sabe a população).
 */
export async function listReceiptEventsInPeriod(
  db: FinanceReceiptsDb,
  args: { from: Date; to: Date; receivableExternalIds?: readonly number[] }
): Promise<FinanceReceiptEvent[]> {
  const where: Prisma.NomusReceivableReceiptWhereInput = {
    receiptDate: { gte: args.from, lte: args.to },
  };
  if (args.receivableExternalIds) {
    where.receivableExternalId = { in: [...new Set(args.receivableExternalIds)] };
  }
  const rows = await db.nomusReceivableReceipt.findMany({
    where,
    select: RECEIPT_EVENT_SELECT,
  });
  return rows.map(mapReceiptEventRow);
}

/**
 * Primitiva 2 — soma real recebida no período (CAIXA). Fonte única para
 * qualquer métrica rotulada "Recebido"/"Caixa"/"Realizado" com recorte de
 * data. Nunca `receiptDate ?? settlementDate` — se não há receipt, o valor é
 * zero para aquele período, ponto.
 */
export async function sumReceivedAmountInPeriod(
  db: FinanceReceiptsDb,
  args: { from: Date; to: Date; receivableExternalIds?: readonly number[] }
): Promise<{ count: number; totalReceivedAmount: number }> {
  const events = await listReceiptEventsInPeriod(db, args);
  return { count: events.length, totalReceivedAmount: sumReceivedAmountForEvents(events) };
}

/**
 * Primitiva 3 — eventos de recebimento de UM título (todo o histórico).
 */
export async function listReceiptEventsByReceivable(
  db: FinanceReceiptsDb,
  receivableExternalId: number
): Promise<FinanceReceiptEvent[]> {
  const rows = await db.nomusReceivableReceipt.findMany({
    where: { receivableExternalId },
    select: RECEIPT_EVENT_SELECT,
    orderBy: { receiptDate: "asc" },
  });
  return rows.map(mapReceiptEventRow);
}

/**
 * Primitiva 3b — eventos de recebimento de VÁRIOS títulos, em lote (evita
 * N+1 quando o consumidor precisa dos eventos de uma lista de CRs).
 */
export async function listReceiptEventsByReceivables(
  db: FinanceReceiptsDb,
  receivableExternalIds: readonly number[]
): Promise<Map<number, FinanceReceiptEvent[]>> {
  const unique = [...new Set(receivableExternalIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return new Map();
  const rows = await db.nomusReceivableReceipt.findMany({
    where: { receivableExternalId: { in: unique } },
    select: RECEIPT_EVENT_SELECT,
    orderBy: { receiptDate: "asc" },
  });
  return groupReceiptEventsByReceivable(rows.map(mapReceiptEventRow));
}

/**
 * Primitiva 4 — soma acumulada de receipts de uma lista de títulos (todo o
 * histórico, não um período). Serve para conferência contra
 * `NomusAccountsReceivable.amountReceived` (ver seção "estado do título ×
 * eventos" da auditoria de reconciliação) — nunca para decidir competência
 * de um mês.
 */
export async function sumReceivedAmountByReceivables(
  db: FinanceReceiptsDb,
  receivableExternalIds: readonly number[]
): Promise<Map<number, number>> {
  const byReceivable = await listReceiptEventsByReceivables(db, receivableExternalIds);
  const out = new Map<number, number>();
  for (const [id, events] of byReceivable) out.set(id, sumReceivedAmountForEvents(events));
  return out;
}

/**
 * Primitiva 5 — cobertura: quais títulos (dentre os informados) têm QUALQUER
 * receipt registrado localmente, independente de data.
 */
export async function loadReceivableIdsWithAnyReceipt(
  db: FinanceReceiptsDb,
  receivableExternalIds: readonly number[]
): Promise<Set<number>> {
  const unique = [...new Set(receivableExternalIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return new Set();
  const rows = await db.nomusReceivableReceipt.findMany({
    where: { receivableExternalId: { in: unique } },
    select: { receivableExternalId: true },
    distinct: ["receivableExternalId"],
  });
  return new Set(rows.map((row) => row.receivableExternalId));
}

/**
 * Primitiva 6 — títulos baixados/recebidos (`settlementDate` preenchida, no
 * recorte informado) sem NENHUM receipt local ainda. Nunca inventa caixa
 * para esses títulos; apenas identifica o estado `SETTLED_WITHOUT_RECEIPT`
 * para quem for decidir o que fazer (auditoria, alerta, exclusão explícita).
 *
 * Custo: 2 queries em lote (nunca uma por título).
 */
export async function loadSettledWithoutReceiptReceivables(
  db: FinanceReceiptsWithArDb,
  args: { settlementFrom: Date; settlementTo: Date }
): Promise<FinanceReceivableSettlementInconsistency[]> {
  const settled = await db.nomusAccountsReceivable.findMany({
    where: {
      settlementDate: { gte: args.settlementFrom, lte: args.settlementTo },
      amountReceived: { gt: 0 },
    },
    select: { externalId: true },
  });
  const settledIds = settled.map((row) => row.externalId);
  if (settledIds.length === 0) return [];
  const withAnyReceipt = await loadReceivableIdsWithAnyReceipt(db, settledIds);
  return detectSettledWithoutReceipt(settledIds, withAnyReceipt);
}

/**
 * Primitiva 7 — freshness do ledger local de receipts. Para exibir
 * honestamente "dados de recebimento atualizados até HH:MM" nas telas que
 * consomem esta camada.
 */
export async function resolveFinanceReceiptsFreshness(
  db: FinanceReceiptsDb
): Promise<FinanceReceiptsFreshness> {
  const [agg, count] = await Promise.all([
    db.nomusReceivableReceipt.aggregate({
      _max: { syncedAt: true, receiptDate: true },
      _min: { receiptDate: true },
    }),
    db.nomusReceivableReceipt.count(),
  ]);
  return {
    maxSyncedAt: agg._max.syncedAt ?? null,
    minReceiptDate: agg._min.receiptDate ?? null,
    maxReceiptDate: agg._max.receiptDate ?? null,
    totalCount: count,
  };
}

export {
  civilDateStringToUtcMidnight,
  classifyReceivableSettlement,
  detectSettledWithoutReceipt,
  financeReceiptCivilDateKey,
  financeReceiptCivilMonthKey,
  groupReceiptEventsByReceivable,
  isReceiptInCivilPeriod,
  resolveCivilMonthUtcBounds,
  resolveCivilRangeUtcBounds,
  resolveCivilYearUtcBounds,
  sumReceivedAmountByReceivable,
  sumReceivedAmountForEvents,
  FINANCE_SETTLED_WITHOUT_RECEIPT_REASON,
  type FinanceReceiptEvent,
  type FinanceReceivableSettlementClass,
  type FinanceReceivableSettlementInconsistency,
  type FinanceReceiptsFreshness,
} from "./financeReceiptsCanonical.js";

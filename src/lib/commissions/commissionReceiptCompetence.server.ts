/**
 * Acesso a dados da competência por recebimento.
 *
 * Ponto ÚNICO de seleção temporal do módulo de comissões: motor, materialização,
 * auditoria, reprocesso e reconciliação usam estas funções para que engine e
 * materialização enxerguem exatamente a MESMA população (sem NO_SCHEDULE por
 * divergência de universo).
 */

import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./commission-money.js";
import {
  buildReceiptCompetenceByReceivable,
  detectSettledWithoutReceipt,
  resolveCompetencePeriodUtcBounds,
  type CommissionCompetenceInconsistency,
  type CommissionReceiptCompetence,
  type CommissionReceiptEventInput,
} from "./commissionReceiptCompetence.js";

export type CompetenceDb = Pick<PrismaClient, "nomusReceivableReceipt">;
export type CompetenceWithArDb = Pick<
  PrismaClient,
  "nomusReceivableReceipt" | "nomusAccountsReceivable"
>;

async function loadReceiptEventsForPeriod(
  db: CompetenceDb,
  year: number,
  month: number
): Promise<CommissionReceiptEventInput[]> {
  const { from, to } = resolveCompetencePeriodUtcBounds(year, month);

  const inPeriod = await db.nomusReceivableReceipt.findMany({
    where: { receiptDate: { gte: from, lte: to } },
    select: {
      externalId: true,
      receivableExternalId: true,
      receiptDate: true,
      receivedAmount: true,
    },
  });

  const receivableIds = [...new Set(inPeriod.map((row) => row.receivableExternalId))];
  // Recebimentos anteriores dos MESMOS títulos: alimentam o cap incremental
  // (mês seguinte de um recebimento parcial libera só o saldo da comissão).
  const before =
    receivableIds.length > 0
      ? await db.nomusReceivableReceipt.findMany({
          where: {
            receivableExternalId: { in: receivableIds },
            receiptDate: { lt: from },
          },
          select: {
            externalId: true,
            receivableExternalId: true,
            receiptDate: true,
            receivedAmount: true,
          },
        })
      : [];

  return [...inPeriod, ...before].map((row) => ({
    receiptExternalId: row.externalId,
    receivableExternalId: row.receivableExternalId,
    receiptDate: row.receiptDate,
    receivedAmount: decimalToNumber(row.receivedAmount),
  }));
}

/** Competência do mês por título — fonte oficial do período de comissão. */
export async function loadCommissionReceiptCompetenceForPeriod(
  db: CompetenceDb,
  year: number,
  month: number
): Promise<Map<number, CommissionReceiptCompetence>> {
  const events = await loadReceiptEventsForPeriod(db, year, month);
  return buildReceiptCompetenceByReceivable(events, year, month);
}

/**
 * Títulos com recebimento no período — universo temporal canônico.
 * Substitui `settlementDate: { gte, lte }` em toda seleção de "recebimentos do mês".
 */
export async function loadCommissionCompetenceReceivableIdsForPeriod(
  db: CompetenceDb,
  year: number,
  month: number
): Promise<number[]> {
  const { from, to } = resolveCompetencePeriodUtcBounds(year, month);
  const rows = await db.nomusReceivableReceipt.findMany({
    where: { receiptDate: { gte: from, lte: to } },
    select: { receivableExternalId: true },
    distinct: ["receivableExternalId"],
  });
  return rows.map((row) => row.receivableExternalId);
}

/** Títulos com QUALQUER recebimento registrado (sem recorte de período). */
export async function loadReceivableIdsWithAnyReceipt(
  db: CompetenceDb,
  receivableIds: number[]
): Promise<Set<number>> {
  const unique = [...new Set(receivableIds.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return new Set();
  const rows = await db.nomusReceivableReceipt.findMany({
    where: { receivableExternalId: { in: unique } },
    select: { receivableExternalId: true },
    distinct: ["receivableExternalId"],
  });
  return new Set(rows.map((row) => row.receivableExternalId));
}

/**
 * TESTE 6 — baixa no período sem recebimento correspondente.
 * A baixa NÃO é usada como fallback: o caso é reportado como inconsistência.
 */
export async function loadSettledWithoutReceiptInconsistencies(
  db: CompetenceWithArDb,
  year: number,
  month: number
): Promise<CommissionCompetenceInconsistency[]> {
  const { from, to } = resolveCompetencePeriodUtcBounds(year, month);
  const [settled, competence] = await Promise.all([
    db.nomusAccountsReceivable.findMany({
      where: {
        settlementDate: { gte: from, lte: to },
        amountReceived: { gt: 0 },
      },
      select: { externalId: true },
    }),
    loadCommissionReceiptCompetenceForPeriod(db, year, month),
  ]);
  return detectSettledWithoutReceipt(
    settled.map((row) => row.externalId),
    competence
  );
}

/**
 * Recebimentos sem CR local (`idContaReceber` sem `NomusAccountsReceivable`).
 * Relatório de cobertura da sincronização — nunca resolvido por join aproximado.
 */
export async function loadReceiptsWithoutLocalReceivable(
  db: CompetenceWithArDb,
  options: { limit?: number } = {}
): Promise<
  Array<{
    receivableExternalId: number;
    receiptCount: number;
    receivedAmount: number;
    firstReceiptDate: Date;
    lastReceiptDate: Date;
  }>
> {
  const receipts = await db.nomusReceivableReceipt.findMany({
    select: {
      receivableExternalId: true,
      receiptDate: true,
      receivedAmount: true,
    },
    orderBy: { receiptDate: "desc" },
    ...(options.limit != null ? { take: options.limit } : {}),
  });
  if (receipts.length === 0) return [];

  const receivableIds = [...new Set(receipts.map((row) => row.receivableExternalId))];
  const known = await db.nomusAccountsReceivable.findMany({
    where: { externalId: { in: receivableIds } },
    select: { externalId: true },
  });
  const knownSet = new Set(known.map((row) => row.externalId));

  const acc = new Map<
    number,
    {
      receivableExternalId: number;
      receiptCount: number;
      receivedAmount: number;
      firstReceiptDate: Date;
      lastReceiptDate: Date;
    }
  >();
  for (const row of receipts) {
    if (knownSet.has(row.receivableExternalId)) continue;
    const current = acc.get(row.receivableExternalId);
    const amount = decimalToNumber(row.receivedAmount);
    if (!current) {
      acc.set(row.receivableExternalId, {
        receivableExternalId: row.receivableExternalId,
        receiptCount: 1,
        receivedAmount: amount,
        firstReceiptDate: row.receiptDate,
        lastReceiptDate: row.receiptDate,
      });
      continue;
    }
    current.receiptCount += 1;
    current.receivedAmount += amount;
    if (row.receiptDate < current.firstReceiptDate) current.firstReceiptDate = row.receiptDate;
    if (row.receiptDate > current.lastReceiptDate) current.lastReceiptDate = row.receiptDate;
  }

  return [...acc.values()].sort(
    (a, b) => a.receivableExternalId - b.receivableExternalId
  );
}

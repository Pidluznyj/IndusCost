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
  partitionSettledReceivablesForAudit,
  resolveCompetencePeriodUtcBounds,
  type CommissionCompetenceInconsistency,
  type CommissionReceiptCompetence,
  type CommissionReceiptEventInput,
  type SettledReceivablesAuditPartition,
} from "./commissionReceiptCompetence.js";
import { isCommissionInternalGroupReceivable } from "./commissionInternalGroupExclusion.js";
import { loadReceivableIdsWithAnyReceipt as loadReceivableIdsWithAnyReceiptCanonical } from "../financeReceiptsCanonical.server.js";
import { NOMUS_NFE_STATUS_CANCELLED } from "../nomusNfeClassification.js";

export type CompetenceDb = Pick<PrismaClient, "nomusReceivableReceipt">;
export type CompetenceWithArDb = Pick<
  PrismaClient,
  "nomusReceivableReceipt" | "nomusAccountsReceivable"
>;
/** Auditoria de baixas: também lê a NF-e de origem para reconhecer a cancelada. */
export type CompetenceSettlementAuditDb = Pick<
  PrismaClient,
  "nomusReceivableReceipt" | "nomusAccountsReceivable" | "nomusNfe"
>;

/**
 * Recorte opcional dos eventos DO PERÍODO (os anteriores seguem inteiros no cap
 * incremental, igual à competência normal):
 *   - include: só estes eventos (pendência de período anterior avaliada na sua
 *     competência natural, sem reabrir o que já foi contemplado);
 *   - alreadyCovered (com include): eventos dos MESMOS títulos já pagos por uma
 *     fonte oficial — do período ou de meses posteriores — entram como anteriores.
 *     A pendência libera só o incremento sobre o que já foi pago (ordem de
 *     pagamento): a soma nunca passa da comissão do título;
 *   - exclude: todos menos estes (competência atual sem eventos já cobertos por
 *     outra fonte oficial).
 */
export type CommissionReceiptEventScope = {
  includeReceiptExternalIds?: readonly number[] | null;
  alreadyCoveredReceiptExternalIds?: readonly number[] | null;
  excludeReceiptExternalIds?: readonly number[] | null;
};

async function loadReceiptEventsForPeriod(
  db: CompetenceDb,
  year: number,
  month: number,
  scope?: CommissionReceiptEventScope | null
): Promise<CommissionReceiptEventInput[]> {
  const { from, to } = resolveCompetencePeriodUtcBounds(year, month);
  const include = scope?.includeReceiptExternalIds ?? null;
  if (include != null && include.length === 0) return [];
  const exclude = new Set(scope?.excludeReceiptExternalIds ?? []);

  const inPeriodRows = await db.nomusReceivableReceipt.findMany({
    where: {
      receiptDate: { gte: from, lte: to },
      ...(include != null ? { externalId: { in: [...include] } } : {}),
    },
    select: {
      externalId: true,
      receivableExternalId: true,
      receiptDate: true,
      receivedAmount: true,
    },
  });
  const inPeriod =
    exclude.size > 0 ? inPeriodRows.filter((row) => !exclude.has(row.externalId)) : inPeriodRows;

  const receivableIds = [...new Set(inPeriod.map((row) => row.receivableExternalId))];
  // Pendência (include): eventos dos mesmos títulos já pagos (do período ou
  // posteriores) contam como anteriores no cap incremental.
  const includeSet = new Set(include ?? []);
  const alreadyCoveredIds = (scope?.alreadyCoveredReceiptExternalIds ?? []).filter(
    (id) => !includeSet.has(id)
  );
  const alreadyCovered =
    include != null && receivableIds.length > 0 && alreadyCoveredIds.length > 0
      ? await db.nomusReceivableReceipt.findMany({
          where: {
            receivableExternalId: { in: receivableIds },
            receiptDate: { gte: from },
            externalId: { in: alreadyCoveredIds },
          },
          select: {
            externalId: true,
            receivableExternalId: true,
            receiptDate: true,
            receivedAmount: true,
          },
        })
      : [];
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

  return [
    ...[...inPeriod, ...before].map((row) => ({
      receiptExternalId: row.externalId,
      receivableExternalId: row.receivableExternalId,
      receiptDate: row.receiptDate,
      receivedAmount: decimalToNumber(row.receivedAmount),
    })),
    ...alreadyCovered.map((row) => ({
      receiptExternalId: row.externalId,
      receivableExternalId: row.receivableExternalId,
      receiptDate: row.receiptDate,
      receivedAmount: decimalToNumber(row.receivedAmount),
      countsAsPrior: true,
    })),
  ];
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

/** Competência do mês restrita a um recorte de eventos (mesma regra de agregação). */
export async function loadCommissionReceiptCompetenceForScope(
  db: CompetenceDb,
  year: number,
  month: number,
  scope: CommissionReceiptEventScope
): Promise<Map<number, CommissionReceiptCompetence>> {
  const events = await loadReceiptEventsForPeriod(db, year, month, scope);
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

/**
 * Títulos com QUALQUER recebimento registrado (sem recorte de período).
 *
 * Delega para a camada canônica neutra (`financeReceiptsCanonical.server.ts`,
 * primitiva 5) — a query é idêntica byte a byte à que existia aqui antes;
 * mantida como re-export local para não mudar a superfície pública deste
 * módulo (import path e assinatura preservados para os chamadores atuais).
 */
export async function loadReceivableIdsWithAnyReceipt(
  db: CompetenceDb,
  receivableIds: number[]
): Promise<Set<number>> {
  return loadReceivableIdsWithAnyReceiptCanonical(db, receivableIds);
}

export type SettledReceivableAuditRow = {
  externalId: number;
  sourceInvoiceId: number | null;
  personName: string | null;
  personCnpj: string | null;
};

export type SettledReceivablesAudit = SettledReceivablesAuditPartition & {
  /** Todos os títulos baixados no período com `amountReceived > 0`. */
  settled: SettledReceivableAuditRow[];
};

/**
 * NF-es CANCELADAS dentre as informadas, pelo vínculo determinístico
 * `NomusAccountsReceivable.sourceInvoiceId` → `NomusNfe.externalId`.
 * Mesma semântica do módulo de comissões (`commission-source-resolver`):
 * cancelada = status `NOMUS_NFE_STATUS_CANCELLED`. Uma query, em lote.
 */
async function loadCancelledInvoiceIds(
  db: Pick<PrismaClient, "nomusNfe">,
  invoiceIds: number[]
): Promise<Set<number>> {
  if (invoiceIds.length === 0) return new Set();
  const rows = await db.nomusNfe.findMany({
    where: { externalId: { in: invoiceIds }, status: NOMUS_NFE_STATUS_CANCELLED },
    select: { externalId: true },
  });
  return new Set(rows.map((row) => row.externalId));
}

/**
 * Fonte ÚNICA da auditoria de baixas do período: a lista de inconsistências e as
 * contagens agregadas saem desta mesma partição (nunca de duas consultas).
 *
 * A existência de receipt é verificada em TODO o histórico do título
 * (`loadReceivableIdsWithAnyReceipt`), nunca dentro da janela de competência:
 * um CR recebido em 30/06 e baixado em 01/07 tem movimentação financeira real
 * e não pode ser reportado como baixa sem caixa ao processar julho.
 *
 * Baixa sem receipt cuja NF-e de origem está CANCELADA é baixa administrativa
 * do cancelamento: não houve caixa e não falta receipt. Fica classificada à
 * parte e fora de `SETTLED_WITHOUT_RECEIPT`. Nada aqui cria receipt,
 * competência, schedule ou comissão — é só classificação.
 *
 * Custo: no máximo 3 queries, todas em lote (baixados, receipts, NF-es canceladas).
 * A terceira só roda se existir baixado sem receipt com NF vinculada.
 */
export async function loadSettledReceivablesAuditForPeriod(
  db: CompetenceSettlementAuditDb,
  year: number,
  month: number
): Promise<SettledReceivablesAudit> {
  const { from, to } = resolveCompetencePeriodUtcBounds(year, month);
  const settled = await db.nomusAccountsReceivable.findMany({
    where: {
      settlementDate: { gte: from, lte: to },
      amountReceived: { gt: 0 },
    },
    select: { externalId: true, sourceInvoiceId: true, personName: true, personCnpj: true },
  });
  if (settled.length === 0) {
    return { settled: [], financialReceiptIds: [], cancelledInvoiceSettlementIds: [], settledWithoutReceipt: [] };
  }

  const withAnyReceipt = await loadReceivableIdsWithAnyReceipt(
    db,
    settled.map((row) => row.externalId)
  );
  const candidateInvoiceIds = [
    ...new Set(
      settled
        .filter((row) => !withAnyReceipt.has(row.externalId) && row.sourceInvoiceId != null)
        .map((row) => row.sourceInvoiceId as number)
    ),
  ];
  const cancelledInvoiceIds = await loadCancelledInvoiceIds(db, candidateInvoiceIds);

  return {
    settled,
    ...partitionSettledReceivablesForAudit(
      settled.map((row) => ({ receivableExternalId: row.externalId, sourceInvoiceId: row.sourceInvoiceId })),
      withAnyReceipt,
      cancelledInvoiceIds
    ),
  };
}

/**
 * Baixa sem movimentação financeira no período (`SETTLED_WITHOUT_RECEIPT`).
 *
 * Não inclui baixa de NF-e cancelada. A baixa continua sem virar fallback de
 * competência — o caso é apenas reportado como inconsistência.
 */
export async function loadSettledWithoutReceiptInconsistencies(
  db: CompetenceSettlementAuditDb,
  year: number,
  month: number
): Promise<CommissionCompetenceInconsistency[]> {
  return (await loadSettledReceivablesAuditForPeriod(db, year, month)).settledWithoutReceipt;
}

/**
 * Números agregados da auditoria de baixas, a partir da MESMA partição da lista
 * detalhada. `limit` corta só as listas de ids exibidas, nunca as contagens.
 */
export function summarizeSettledReceivablesAudit(audit: SettledReceivablesAudit, limit: number) {
  // Intercompany é apenas CONTADO aqui; a política de elegibilidade não muda.
  const intercompany = audit.settled.filter((row) =>
    isCommissionInternalGroupReceivable({ customerName: row.personName, customerCnpj: row.personCnpj })
  ).length;
  const withoutReceiptIds = audit.settledWithoutReceipt.map((row) => row.receivableExternalId);
  return {
    titulos_baixados_no_periodo: audit.settled.length,
    titulos_baixados_com_receipt_real: audit.financialReceiptIds.length,
    titulos_baixados_intercompany: intercompany,
    titulos_baixados_nfe_cancelada: audit.cancelledInvoiceSettlementIds.length,
    titulos_baixados_nfe_cancelada_ids: audit.cancelledInvoiceSettlementIds.slice(0, limit),
    titulos_com_baixa_no_periodo_sem_recebimento: withoutReceiptIds.length,
    // Conferência: recebimento real + NF cancelada + sem recebimento = todos os baixados.
    conferencia_sem_recebimento_bate:
      audit.financialReceiptIds.length + audit.cancelledInvoiceSettlementIds.length + withoutReceiptIds.length ===
      new Set(audit.settled.map((row) => row.externalId)).size,
    titulos_com_baixa_no_periodo_sem_recebimento_ids: withoutReceiptIds.slice(0, limit),
  };
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

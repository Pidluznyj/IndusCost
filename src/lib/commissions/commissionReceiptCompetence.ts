/**
 * Competência mensal da comissão pela DATA REAL DO RECEBIMENTO.
 *
 * Regra oficial (aprovada):
 *   `recebimentos.dataRecebimento` → `NomusReceivableReceipt.receiptDate` → competência.
 *   `contasReceber.dataBaixa`      → `NomusAccountsReceivable.settlementDate` → baixa
 *                                     administrativa/auditável, NUNCA competência.
 *
 * Recebimento de 31/07 baixado em 03/08 é competência de JULHO.
 * Recebimento de 30/06 baixado em 01/07 é competência de JUNHO.
 *
 * Módulo puro (sem Prisma/rede) — comparações por DIA CIVIL, imunes a fuso.
 */

import { toCivilDateKey } from "../financeCivilDate.js";
import { roundMoney } from "./commission-money.shared.js";

/** Evento de recebimento vindo de `NomusReceivableReceipt`. */
export type CommissionReceiptEventInput = {
  /** `NomusReceivableReceipt.externalId` (recebimentos.id). */
  receiptExternalId: number;
  /** `NomusReceivableReceipt.receivableExternalId` (recebimentos.idContaReceber). */
  receivableExternalId: number;
  /** Dia civil de `dataRecebimento`. */
  receiptDate: Date | string;
  receivedAmount: number;
};

/**
 * Agregado por título de um período de competência.
 *
 * Vários recebimentos do MESMO título no MESMO mês são somados aqui, em uma
 * única competência — por isso a identidade do ledger (V1) não muda e não há
 * colisão de linha. `receiptIds` fica disponível para auditoria.
 */
export type CommissionReceiptCompetence = {
  receivableExternalId: number;
  /** Recebimento mais recente do período — data exibida como "Recebimento". */
  receiptDate: Date;
  /** Recebimento mais antigo do período. */
  firstReceiptDate: Date;
  /** Ids de origem dos eventos do período (auditoria; fora do hash do ledger). */
  receiptIds: number[];
  /** Σ valorRecebido dos eventos DENTRO do período. */
  periodReceivedAmount: number;
  /** Σ valorRecebido dos eventos ANTERIORES ao período (cap incremental). */
  priorReceivedAmount: number;
  /** prior + período. */
  cumulativeReceivedAmount: number;
};

/** Chave civil `YYYY-MM` do dia do recebimento. */
export function receiptCompetenceMonthKey(
  value: Date | string | null | undefined
): string | null {
  const key = toCivilDateKey(value);
  return key ? key.slice(0, 7) : null;
}

/** `YYYY-MM` do período pedido. */
export function buildCompetenceMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Comparação por dia civil — 31/07 nunca cai em agosto por causa de fuso. */
export function isReceiptInCompetencePeriod(
  receiptDate: Date | string | null | undefined,
  year: number,
  month: number
): boolean {
  const key = receiptCompetenceMonthKey(receiptDate);
  return key != null && key === buildCompetenceMonthKey(year, month);
}

export function isReceiptBeforeCompetencePeriod(
  receiptDate: Date | string | null | undefined,
  year: number,
  month: number
): boolean {
  const key = receiptCompetenceMonthKey(receiptDate);
  return key != null && key < buildCompetenceMonthKey(year, month);
}

/**
 * Limites UTC do mês para consultar colunas PostgreSQL DATE.
 *
 * Nunca usar `new Date(year, month - 1, 1)` (meia-noite LOCAL) contra uma coluna
 * DATE: o Prisma devolve/envia meia-noite UTC e o recorte perderia (ou ganharia)
 * o primeiro/último dia do mês conforme o fuso da máquina.
 */
export function resolveCompetencePeriodUtcBounds(
  year: number,
  month: number
): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0)),
  };
}

function toCivilDate(value: Date | string): Date {
  const key = toCivilDateKey(value);
  if (!key) return new Date(Number.NaN);
  return new Date(`${key}T00:00:00.000Z`);
}

/**
 * Agrupa eventos de recebimento por título para o período pedido.
 *
 * Recebe TODOS os eventos conhecidos dos títulos (não só os do mês): os
 * anteriores alimentam `priorReceivedAmount`, que faz a liberação do mês ser
 * incremental e nunca ultrapassar a comissão total da venda.
 */
export function buildReceiptCompetenceByReceivable(
  events: CommissionReceiptEventInput[],
  year: number,
  month: number
): Map<number, CommissionReceiptCompetence> {
  const acc = new Map<number, CommissionReceiptCompetence>();

  for (const event of events) {
    const amount = Number.isFinite(event.receivedAmount) ? event.receivedAmount : 0;
    const inPeriod = isReceiptInCompetencePeriod(event.receiptDate, year, month);
    const beforePeriod = isReceiptBeforeCompetencePeriod(event.receiptDate, year, month);
    // Recebimentos POSTERIORES ao período não entram: a competência de julho não
    // pode ser alterada por um recebimento de agosto.
    if (!inPeriod && !beforePeriod) continue;

    const current =
      acc.get(event.receivableExternalId) ??
      ({
        receivableExternalId: event.receivableExternalId,
        receiptDate: new Date(Number.NaN),
        firstReceiptDate: new Date(Number.NaN),
        receiptIds: [],
        periodReceivedAmount: 0,
        priorReceivedAmount: 0,
        cumulativeReceivedAmount: 0,
      } satisfies CommissionReceiptCompetence);

    if (beforePeriod) {
      current.priorReceivedAmount = roundMoney(current.priorReceivedAmount + amount);
    } else {
      const civil = toCivilDate(event.receiptDate);
      current.periodReceivedAmount = roundMoney(current.periodReceivedAmount + amount);
      current.receiptIds.push(event.receiptExternalId);
      if (Number.isNaN(current.receiptDate.getTime()) || civil > current.receiptDate) {
        current.receiptDate = civil;
      }
      if (
        Number.isNaN(current.firstReceiptDate.getTime()) ||
        civil < current.firstReceiptDate
      ) {
        current.firstReceiptDate = civil;
      }
    }

    current.cumulativeReceivedAmount = roundMoney(
      current.priorReceivedAmount + current.periodReceivedAmount
    );
    acc.set(event.receivableExternalId, current);
  }

  // Só títulos com recebimento DENTRO do período compõem a competência do mês.
  const result = new Map<number, CommissionReceiptCompetence>();
  for (const [receivableId, row] of acc) {
    if (row.receiptIds.length === 0) continue;
    row.receiptIds.sort((a, b) => a - b);
    result.set(receivableId, row);
  }
  return result;
}

/** Motivos auditáveis de divergência entre baixa e recebimento. */
export const COMMISSION_SETTLED_WITHOUT_RECEIPT_REASON =
  "Título com baixa no período e sem evento de recebimento sincronizado — competência não pode vir da baixa";

export const COMMISSION_RECEIPT_WITHOUT_LOCAL_RECEIVABLE_REASON =
  "Recebimento Nomus sem Conta a Receber local correspondente";

export type CommissionCompetenceInconsistency = {
  code: "SETTLED_WITHOUT_RECEIPT" | "RECEIPT_WITHOUT_LOCAL_RECEIVABLE";
  receivableExternalId: number;
  reason: string;
};

/**
 * TESTE 6 — baixa presente, recebimento ausente.
 * Não vira fallback silencioso: vira inconsistência detectável.
 */
export function detectSettledWithoutReceipt(
  settledReceivableIdsInPeriod: Iterable<number>,
  competenceByReceivable: Map<number, CommissionReceiptCompetence>
): CommissionCompetenceInconsistency[] {
  const out: CommissionCompetenceInconsistency[] = [];
  const seen = new Set<number>();
  for (const receivableId of settledReceivableIdsInPeriod) {
    if (seen.has(receivableId)) continue;
    seen.add(receivableId);
    if (competenceByReceivable.has(receivableId)) continue;
    out.push({
      code: "SETTLED_WITHOUT_RECEIPT",
      receivableExternalId: receivableId,
      reason: COMMISSION_SETTLED_WITHOUT_RECEIPT_REASON,
    });
  }
  return out.sort((a, b) => a.receivableExternalId - b.receivableExternalId);
}

/** Recebimentos cujo `idContaReceber` não tem CR local (vínculo determinístico ausente). */
export function detectReceiptsWithoutLocalReceivable(
  competenceByReceivable: Map<number, CommissionReceiptCompetence>,
  knownReceivableIds: Iterable<number>
): CommissionCompetenceInconsistency[] {
  const known = new Set(knownReceivableIds);
  const out: CommissionCompetenceInconsistency[] = [];
  for (const receivableId of competenceByReceivable.keys()) {
    if (known.has(receivableId)) continue;
    out.push({
      code: "RECEIPT_WITHOUT_LOCAL_RECEIVABLE",
      receivableExternalId: receivableId,
      reason: COMMISSION_RECEIPT_WITHOUT_LOCAL_RECEIVABLE_REASON,
    });
  }
  return out.sort((a, b) => a.receivableExternalId - b.receivableExternalId);
}

/**
 * Liberação incremental do período sobre a comissão programada do título.
 *
 * `liberado(mês) = programado × razão(acumulado) − programado × razão(anterior)`
 * com razão = min(1, min(recebido, original) / original).
 *
 * CR 10.000 / comissão 300, recebimentos 4.000 (31/07) e 6.000 (05/08):
 * julho libera 120 (40%), agosto libera 180 (60%), total 300 — nunca 300 + 300.
 */
export type CommissionCompetenceReleaseBreakdown = {
  /** Principal comissionável reconhecido NESTE período. */
  periodPrincipalAmount: number;
  /** Comissão liberada NESTE período (delta). */
  periodReleasedCommissionAmount: number;
  /** Comissão liberada acumulada até o fim do período (cap). */
  cumulativeReleasedCommissionAmount: number;
  /** Comissão já liberada antes do período. */
  priorReleasedCommissionAmount: number;
  /** Fatia do título reconhecida no período, em %. */
  periodSharePercent: number;
  /** Recebido bruto do período (pode incluir juros/multa). */
  periodReceivedGrossAmount: number;
  /** Encargos ignorados reconhecidos neste período. */
  periodIgnoredFinancialChargesAmount: number;
};

export function computeCompetenceReleaseBreakdown(input: {
  receivableOriginalAmount: number;
  scheduledCommissionAmount: number;
  competence: Pick<
    CommissionReceiptCompetence,
    "periodReceivedAmount" | "priorReceivedAmount"
  >;
}): CommissionCompetenceReleaseBreakdown {
  const original = roundMoney(Math.max(0, input.receivableOriginalAmount));
  const prior = roundMoney(Math.max(0, input.competence.priorReceivedAmount));
  const period = roundMoney(Math.max(0, input.competence.periodReceivedAmount));
  const cumulative = roundMoney(prior + period);
  const scheduled = roundMoney(Math.max(0, input.scheduledCommissionAmount));

  const priorPrincipal = original > 0 ? roundMoney(Math.min(prior, original)) : prior;
  const cumulativePrincipal =
    original > 0 ? roundMoney(Math.min(cumulative, original)) : cumulative;
  const periodPrincipal = roundMoney(Math.max(0, cumulativePrincipal - priorPrincipal));

  const priorRatio = original > 0 ? Math.min(1, priorPrincipal / original) : 0;
  const cumulativeRatio = original > 0 ? Math.min(1, cumulativePrincipal / original) : 0;

  const priorReleased = roundMoney(scheduled * priorRatio);
  const cumulativeReleased = roundMoney(scheduled * cumulativeRatio);
  const periodReleased = roundMoney(Math.max(0, cumulativeReleased - priorReleased));

  const priorIgnored = original > 0 ? roundMoney(Math.max(0, prior - original)) : 0;
  const cumulativeIgnored = original > 0 ? roundMoney(Math.max(0, cumulative - original)) : 0;

  return {
    periodPrincipalAmount: periodPrincipal,
    periodReleasedCommissionAmount: periodReleased,
    cumulativeReleasedCommissionAmount: cumulativeReleased,
    priorReleasedCommissionAmount: priorReleased,
    periodSharePercent: roundMoney((cumulativeRatio - priorRatio) * 100),
    periodReceivedGrossAmount: period,
    periodIgnoredFinancialChargesAmount: roundMoney(
      Math.max(0, cumulativeIgnored - priorIgnored)
    ),
  };
}

/**
 * Camada canônica NEUTRA de recebimentos financeiros — lógica pura (sem
 * Prisma/rede). Fonte única de fato para "quanto dinheiro entrou": todo
 * consumidor de Financeiro, Tesouraria, Metas e Comissões que precisa
 * responder essa pergunta deriva desta camada, nunca reimplementa a conta.
 *
 * Três eixos, nunca fundidos (ver docs/nomus/nomus-receipts-canonical.md):
 *   - `NomusAccountsReceivable.dueDate`        → vencimento contratual (carteira/coorte).
 *   - `NomusAccountsReceivable.settlementDate` → baixa administrativa (`dataBaixa`),
 *                                                  NUNCA competência de caixa.
 *   - `NomusReceivableReceipt.receiptDate`     → dia civil em que o dinheiro
 *                                                  efetivamente entrou. Esta é a
 *                                                  ÚNICA fonte de caixa real.
 *
 * `NomusAccountsReceivable.amountReceived` continua válido, mas como ESTADO
 * ACUMULADO DO TÍTULO (conferência, saldo, "quitado?") — nunca como "quanto
 * entrou num mês específico" quando existem receipts para aquele título.
 *
 * Extraído do que já existia (corretamente) em
 * `src/lib/commissions/commissionReceiptCompetence.ts`, generalizado para uso
 * neutro fora de Comissões. Comissões passa a consumir esta camada para a
 * parte genérica (agregação de eventos, classificação de baixa-sem-receipt);
 * o cálculo de liberação de comissão em si (`computeCompetenceReleaseBreakdown`)
 * continua exclusivamente em `commissions/`, por ser regra de negócio de
 * comissão, não fato financeiro neutro.
 */

import { toCivilDateKey } from "./financeCivilDate.js";

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Composição financeira completa de um evento de `NomusReceivableReceipt`. */
export type FinanceReceiptEvent = {
  /** `NomusReceivableReceipt.externalId` (recebimentos.id) — identidade do evento. */
  receiptExternalId: number;
  /** `NomusReceivableReceipt.receivableExternalId` → `NomusAccountsReceivable.externalId`. */
  receivableExternalId: number;
  /** Dia civil de `receiptDate` (dataRecebimento) — quando o dinheiro entrou. */
  receiptDate: Date | string;
  receivedAmount: number;
  bankFeeAmount: number;
  lateFeeInterestAmount: number;
  discountAmount: number;
  closesReceivable: boolean | null;
};

/** Chave civil `YYYY-MM-DD` do dia do recebimento — nunca desloca por fuso. */
export function financeReceiptCivilDateKey(
  value: Date | string | null | undefined
): string | null {
  return toCivilDateKey(value);
}

/** Chave civil `YYYY-MM` (mês) do dia do recebimento. */
export function financeReceiptCivilMonthKey(
  value: Date | string | null | undefined
): string | null {
  const key = toCivilDateKey(value);
  return key ? key.slice(0, 7) : null;
}

/**
 * Limites UTC do mês para consultar colunas PostgreSQL DATE (`receiptDate`).
 * Nunca usar meia-noite LOCAL contra uma coluna DATE: o Prisma lê/grava meia-
 * noite UTC, e o recorte perderia (ou ganharia) o primeiro/último dia do mês
 * conforme o fuso da máquina que roda a query.
 */
export function resolveCivilMonthUtcBounds(
  year: number,
  month: number
): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0)),
  };
}

/** Limites UTC do ano (1º de janeiro a 31 de dezembro), mesma lógica de dia civil. */
export function resolveCivilYearUtcBounds(year: number): { from: Date; to: Date } {
  return { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31)) };
}

export function isReceiptInCivilPeriod(
  receiptDate: Date | string | null | undefined,
  bounds: { from: Date; to: Date }
): boolean {
  const key = toCivilDateKey(receiptDate);
  if (!key) return false;
  const fromKey = toCivilDateKey(bounds.from);
  const toKey = toCivilDateKey(bounds.to);
  if (!fromKey || !toKey) return false;
  return key >= fromKey && key <= toKey;
}

/** Σ `receivedAmount` de uma lista de eventos — nunca some `amountReceived` do título no lugar disso. */
export function sumReceivedAmountForEvents(events: readonly FinanceReceiptEvent[]): number {
  return roundMoney(events.reduce((acc, e) => acc + (Number.isFinite(e.receivedAmount) ? e.receivedAmount : 0), 0));
}

/** Agrupa eventos por título (`receivableExternalId`) — base para qualquer agregação por CR. */
export function groupReceiptEventsByReceivable(
  events: readonly FinanceReceiptEvent[]
): Map<number, FinanceReceiptEvent[]> {
  const acc = new Map<number, FinanceReceiptEvent[]>();
  for (const event of events) {
    const bucket = acc.get(event.receivableExternalId);
    if (bucket) bucket.push(event);
    else acc.set(event.receivableExternalId, [event]);
  }
  return acc;
}

/** Σ `receivedAmount` acumulado por título, a partir de uma lista de eventos (histórico completo ou recorte). */
export function sumReceivedAmountByReceivable(
  events: readonly FinanceReceiptEvent[]
): Map<number, number> {
  const grouped = groupReceiptEventsByReceivable(events);
  const out = new Map<number, number>();
  for (const [receivableExternalId, list] of grouped) {
    out.set(receivableExternalId, sumReceivedAmountForEvents(list));
  }
  return out;
}

/**
 * Classificação de um título quanto à existência de movimentação financeira
 * REAL. `hasAnyReceipt` precisa ser calculado sobre TODO o histórico do
 * título, nunca só dentro de um recorte de período — um receipt de junho
 * prova caixa real mesmo analisando julho.
 *
 * - `FINANCIAL_RECEIPT`       — existe pelo menos um `NomusReceivableReceipt`.
 * - `SETTLED_WITHOUT_RECEIPT` — baixado no ERP (`settlementDate` presente),
 *                                 sem nenhum receipt: NÃO é caixa. Nunca gera
 *                                 dinheiro fictício em nenhum período.
 * - `OPEN_NOT_RECEIVED`       — sem receipt e sem baixa: título em aberto.
 */
export type FinanceReceivableSettlementClass =
  | "FINANCIAL_RECEIPT"
  | "SETTLED_WITHOUT_RECEIPT"
  | "OPEN_NOT_RECEIVED";

export function classifyReceivableSettlement(input: {
  hasAnyReceipt: boolean;
  isSettled: boolean;
}): FinanceReceivableSettlementClass {
  if (input.hasAnyReceipt) return "FINANCIAL_RECEIPT";
  if (input.isSettled) return "SETTLED_WITHOUT_RECEIPT";
  return "OPEN_NOT_RECEIVED";
}

export const FINANCE_SETTLED_WITHOUT_RECEIPT_REASON =
  "Título baixado no ERP sem NENHUM evento de recebimento associado (em qualquer data) — baixa sem movimentação financeira conhecida localmente";

export type FinanceReceivableSettlementInconsistency = {
  code: "SETTLED_WITHOUT_RECEIPT";
  receivableExternalId: number;
  reason: string;
};

/**
 * Títulos baixados (`settlementDate` presente) sem NENHUM receipt local em
 * todo o histórico. Não é erro automático — é um estado auditável
 * (`SETTLED_WITHOUT_RECEIPT`) que nunca deve virar caixa fictício em
 * nenhuma tela.
 */
export function detectSettledWithoutReceipt(
  settledReceivableIds: Iterable<number>,
  receivableIdsWithAnyReceipt: ReadonlySet<number>
): FinanceReceivableSettlementInconsistency[] {
  const out: FinanceReceivableSettlementInconsistency[] = [];
  const seen = new Set<number>();
  for (const receivableId of settledReceivableIds) {
    if (seen.has(receivableId)) continue;
    seen.add(receivableId);
    if (
      classifyReceivableSettlement({
        hasAnyReceipt: receivableIdsWithAnyReceipt.has(receivableId),
        isSettled: true,
      }) !== "SETTLED_WITHOUT_RECEIPT"
    ) {
      continue;
    }
    out.push({
      code: "SETTLED_WITHOUT_RECEIPT",
      receivableExternalId: receivableId,
      reason: FINANCE_SETTLED_WITHOUT_RECEIPT_REASON,
    });
  }
  return out.sort((a, b) => a.receivableExternalId - b.receivableExternalId);
}

/** Freshness do ledger local de receipts — para exibir "atualizado até" honestamente. */
export type FinanceReceiptsFreshness = {
  maxSyncedAt: Date | null;
  minReceiptDate: Date | null;
  maxReceiptDate: Date | null;
  totalCount: number;
};

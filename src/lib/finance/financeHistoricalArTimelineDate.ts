/**
 * Normalização administrativa histórica da Linha do Tempo Mensal (eixo movement).
 *
 * NÃO é o resolver canônico de settlement (`resolveFinanceEffectiveSettlementDate`).
 * NÃO altera Tesouraria, cards de CR, plannedMonthlyTimeline nem dados Nomus.
 *
 * Em fevereiro/2026 houve baixas em lote de títulos antigos nas datas abaixo.
 * A linha do tempo mensal aloca Recebido por `settlementDate` cru; esses lotes
 * inflavam fevereiro. Esta política devolve a competência ao vencimento só
 * nessas datas e só com atraso > 15 dias CORRIDOS.
 */
import {
  civilDateToLocalDate,
  diffCivilDays,
  toCivilDateKey,
} from "@/src/lib/financeCivilDate.js";
import {
  endOfLocalDay,
  roundMoney,
  type FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";

/** Datas civis de baixa do lote administrativo de fevereiro/2026 (auditoria em produção). */
export const HISTORICAL_AR_ADMIN_SETTLEMENT_DATES: ReadonlySet<string> = new Set([
  "2026-02-04",
  "2026-02-05",
  "2026-02-09",
  "2026-02-19",
]);

/** Atraso mínimo em dias corridos (exclusivo: lag > 15). Não confundir com 3 dias úteis. */
export const HISTORICAL_AR_ADMIN_MIN_LAG_DAYS = 15;

export type HistoricalArTimelineDateInput = {
  dueDate: Date | null | undefined;
  settlementDate: Date | null | undefined;
};

function isHistoricalAdminSettlementKey(key: string | null): boolean {
  return key != null && HISTORICAL_AR_ADMIN_SETTLEMENT_DATES.has(key);
}

/**
 * Data de alocação da Linha do Tempo Mensal (eixo movement) para um título AR.
 *
 * Sem match histórico devolve `settlementDate` intacto — mesma âncora de
 * `sumFinanceArReceivedBySettlementInFilteredRows`.
 * Match histórico devolve meia-noite local do dia civil do vencimento, para
 * o mês da timeline não deslocar por UTC em `DateTime` sem timezone.
 */
export function resolveHistoricalArTimelineDate(
  input: HistoricalArTimelineDateInput
): Date | null {
  const settlementDate = input.settlementDate ?? null;
  if (settlementDate == null) return null;

  const dueDate = input.dueDate ?? null;
  if (dueDate == null) return settlementDate;

  const settlementKey = toCivilDateKey(settlementDate);
  if (settlementKey == null || !isHistoricalAdminSettlementKey(settlementKey)) {
    return settlementDate;
  }

  const dueKey = toCivilDateKey(dueDate);
  if (dueKey == null) return settlementDate;

  if (settlementKey <= dueKey) return settlementDate;

  const lagDays = diffCivilDays(dueDate, settlementDate);
  if (lagDays <= HISTORICAL_AR_ADMIN_MIN_LAG_DAYS) return settlementDate;

  return civilDateToLocalDate(dueKey);
}

/**
 * Soma `amountReceived` pelo dia devolvido por `resolveHistoricalArTimelineDate`.
 * Mesma janela local de `sumFinanceArReceivedBySettlementInFilteredRows`.
 */
export function sumFinanceArReceivedByHistoricalTimelineDateInFilteredRows(
  rows: Pick<FinanceArDashboardRow, "dueDate" | "settlementDate" | "amountReceived">[],
  periodStart: Date,
  periodEnd: Date
): number {
  const startMs = periodStart.getTime();
  const endMs = endOfLocalDay(periodEnd).getTime();
  let total = 0;
  for (const row of rows) {
    const allocatedOn = resolveHistoricalArTimelineDate(row);
    if (allocatedOn && allocatedOn.getTime() >= startMs && allocatedOn.getTime() <= endMs) {
      total += row.amountReceived;
    }
  }
  return roundMoney(total);
}

/**
 * HISTORICAL SETTLEMENT NORMALIZATION V1
 *
 * Overlay de atribuição histórica para linhas do tempo MENSAIS de AR.
 * Não substitui o motor normal de caixa e não consulta banco.
 *
 * Regularização administrativa histórica de AR efetuada em lotes em
 * fevereiro/2026. A baixa Nomus não representa a data real de caixa para
 * esses registros.
 *
 * `settlementDate` no Nomus é a data administrativa de baixa. Em quatro dias
 * comprovados por auditoria, títulos já recebidos em safras anteriores foram
 * baixados em lote. Para esses casos, e somente quando o atraso civil entre
 * vencimento e baixa é > 15 dias corridos, a âncora histórica mensal passa a
 * ser o `dueDate`.
 *
 * Isto NÃO é regra geral de atraso: settlement em 2026-02-20 com lag enorme
 * permanece no motor normal. Também não altera receiptDate de comissão, o
 * resolver canônico dos 3 dias, Contas a Receber, YTD, radar ou o eixo
 * planejado (dueDate).
 */

import { diffCivilDays, toCivilDateKey } from "@/src/lib/financeCivilDate.js";

export const HISTORICAL_SETTLEMENT_NORMALIZATION_POLICY_VERSION =
  "HISTORICAL_SETTLEMENT_NORMALIZATION_V1" as const;

/**
 * Dias civis do lote administrativo de fevereiro/2026.
 * Qualquer outra data — inclusive outros dias de fevereiro — fica de fora.
 */
export const HISTORICAL_AR_ADMIN_SETTLEMENT_BATCH_CIVIL_DATES_V1: ReadonlySet<string> =
  new Set(["2026-02-04", "2026-02-05", "2026-02-09", "2026-02-19"]);

/** Limiar exclusivo: lag > 15. lag === 15 não normaliza. */
export const HISTORICAL_AR_ADMIN_SETTLEMENT_LAG_DAYS_V1 = 15;

export type FinanceArHistoricalMonthlyMovementInput<T extends Date | string> = {
  dueDate: T | null | undefined;
  settlementDate: Date | string | null | undefined;
  /**
   * Data já resolvida pelo motor normal da superfície (settlement cru no
   * Fluxo; data efetiva dos 3 dias na Tesouraria). Devolvida intacta quando
   * o overlay não se aplica.
   */
  normalDate: T | null | undefined;
};

export function isKnownFebruary2026AdministrativeSettlementBatch(
  settlementDate: Date | string | null | undefined
): boolean {
  const key = toCivilDateKey(settlementDate);
  return key != null && HISTORICAL_AR_ADMIN_SETTLEMENT_BATCH_CIVIL_DATES_V1.has(key);
}

/**
 * Decide a data de movimento histórico mensal de um título AR.
 *
 * SE settlement civil ∈ lote V1 E dueDate existe E (settlement − due) > 15
 * ENTÃO dueDate; SENÃO normalDate. dueDate null → nunca inventa data.
 */
export function resolveFinanceArHistoricalMonthlyMovementDate<T extends Date | string>(
  input: FinanceArHistoricalMonthlyMovementInput<T>
): T | null {
  const normalDate = input.normalDate ?? null;
  const dueKey = toCivilDateKey(input.dueDate);
  const settlementKey = toCivilDateKey(input.settlementDate);
  if (
    dueKey != null &&
    input.dueDate != null &&
    settlementKey != null &&
    HISTORICAL_AR_ADMIN_SETTLEMENT_BATCH_CIVIL_DATES_V1.has(settlementKey) &&
    diffCivilDays(dueKey, settlementKey) > HISTORICAL_AR_ADMIN_SETTLEMENT_LAG_DAYS_V1
  ) {
    return input.dueDate;
  }
  return normalDate;
}

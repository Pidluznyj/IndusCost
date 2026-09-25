/**
 * Cutover oficial da comissão Nomus → IndusCost e janela de reconciliação legada.
 * ÚNICO lugar com essas datas — nenhum outro módulo deve hardcodar o corte.
 *
 *   até 30/09/2026 → fonte oficial histórica = Nomus
 *   a partir de 01/10/2026 → fonte oficial = IndusCost
 *
 * Competência natural continua sendo `NomusReceivableReceipt.receiptDate` (dia civil).
 * Módulo puro (sem Prisma/rede), seguro para frontend; comparações por DIA CIVIL.
 */
import { toCivilDateKey } from "../financeCivilDate.js";

/** Primeiro dia em que o IndusCost é a fonte oficial de fechamento de comissão. */
export const COMMISSION_OFFICIAL_CUTOVER_DATE = "2026-10-01";

/**
 * Início da janela de reconciliação legada: recebimentos antes desta data nunca
 * viram pendência automática (histórico do Nomus). Ago/set de 2026 são verificados
 * contra a cobertura importada do Nomus para capturar limbos da transição.
 */
export const COMMISSION_LEGACY_RECONCILIATION_START_DATE = "2026-08-01";

export type CommissionReceiptCutoverPeriod =
  | "LEGACY_OUTSIDE_RECONCILIATION_WINDOW"
  | "LEGACY_RECONCILIATION_WINDOW"
  | "POST_CUTOVER";

export type CommissionYearMonth = { year: number; month: number };

function yearMonthOf(civilKey: string): CommissionYearMonth {
  return { year: Number(civilKey.slice(0, 4)), month: Number(civilKey.slice(5, 7)) };
}

/** Competência (ano/mês) em que o IndusCost passa a ser a fonte oficial. */
export const COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH: CommissionYearMonth = yearMonthOf(
  COMMISSION_OFFICIAL_CUTOVER_DATE
);

/** Primeira competência (ano/mês) da janela de reconciliação legada. */
export const COMMISSION_LEGACY_RECONCILIATION_START_YEAR_MONTH: CommissionYearMonth = yearMonthOf(
  COMMISSION_LEGACY_RECONCILIATION_START_DATE
);

/** Chave comparável `YYYY-MM`. */
export function formatCommissionYearMonthKey(value: CommissionYearMonth): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}`;
}

/** `MM/AAAA` para telas e relatórios. */
export function formatCommissionYearMonthLabel(value: CommissionYearMonth): string {
  return `${String(value.month).padStart(2, "0")}/${value.year}`;
}

export function compareCommissionYearMonth(a: CommissionYearMonth, b: CommissionYearMonth): number {
  return a.year === b.year ? a.month - b.month : a.year - b.year;
}

/** Competência natural (ano/mês) de um recebimento pelo dia civil. */
export function resolveReceiptNaturalYearMonth(
  receiptDate: Date | string | null | undefined
): CommissionYearMonth | null {
  const key = toCivilDateKey(receiptDate);
  return key ? yearMonthOf(key) : null;
}

/** Recebimento antes do cutover (Nomus é a fonte oficial da sua competência)? */
export function isReceiptBeforeCommissionCutover(
  receiptDate: Date | string | null | undefined
): boolean {
  const key = toCivilDateKey(receiptDate);
  return key != null && key < COMMISSION_OFFICIAL_CUTOVER_DATE;
}

/**
 * Em que regime o recebimento está:
 *   - antes de 01/08/2026 → histórico fora da janela (nunca pendência automática);
 *   - 01/08/2026 a 30/09/2026 → janela de reconciliação (verificar cobertura Nomus);
 *   - a partir de 01/10/2026 → IndusCost controla integralmente.
 * Data inválida é tratada como fora da janela (conservador: não vira pendência).
 */
export function resolveReceiptCutoverPeriod(
  receiptDate: Date | string | null | undefined
): CommissionReceiptCutoverPeriod {
  const key = toCivilDateKey(receiptDate);
  if (!key || key < COMMISSION_LEGACY_RECONCILIATION_START_DATE) {
    return "LEGACY_OUTSIDE_RECONCILIATION_WINDOW";
  }
  if (key < COMMISSION_OFFICIAL_CUTOVER_DATE) return "LEGACY_RECONCILIATION_WINDOW";
  return "POST_CUTOVER";
}

/** Fechamento oficial no IndusCost só existe a partir da competência do cutover. */
export function isCompetenceOfficialInIndusCost(year: number, month: number): boolean {
  return compareCommissionYearMonth({ year, month }, COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH) >= 0;
}

/** Mensagem única do bloqueio de fechamento antes do cutover. */
export const COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON =
  `Competências até ${formatCommissionYearMonthLabel(
    previousCommissionYearMonth(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH)
  )} têm o Nomus como fonte oficial de comissão. O fechamento oficial no IndusCost ` +
  `começa em ${formatCommissionYearMonthLabel(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH)}; ` +
  "recebimentos anteriores não cobertos entram como pendência legada nesses fechamentos.";

/** Meses civis de `from` até `to` (inclusive), em ordem. */
export function listCommissionYearMonths(
  from: CommissionYearMonth,
  to: CommissionYearMonth
): CommissionYearMonth[] {
  const out: CommissionYearMonth[] = [];
  let cursor = { ...from };
  while (compareCommissionYearMonth(cursor, to) <= 0) {
    out.push({ ...cursor });
    cursor = cursor.month === 12 ? { year: cursor.year + 1, month: 1 } : { year: cursor.year, month: cursor.month + 1 };
  }
  return out;
}

/** Competência imediatamente anterior. */
export function previousCommissionYearMonth(value: CommissionYearMonth): CommissionYearMonth {
  return value.month === 1 ? { year: value.year - 1, month: 12 } : { year: value.year, month: value.month - 1 };
}

/** Limites UTC [início, fim exclusivo) de uma data civil `YYYY-MM-DD` até outra. */
export function civilDateToUtcDate(civilKey: string): Date {
  return new Date(`${civilKey}T00:00:00.000Z`);
}

/** Primeiro dia (UTC, coluna DATE) da competência. */
export function firstDayOfCompetenceUtc(value: CommissionYearMonth): Date {
  return new Date(Date.UTC(value.year, value.month - 1, 1));
}

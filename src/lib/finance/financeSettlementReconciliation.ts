/**
 * Regra canônica dos N dias de conciliação — resolve a "data efetiva de
 * caixa" a partir da data original de baixa (Nomus) e do vencimento oficial.
 *
 * Contexto: o Nomus grava em `paymentDate` (CP) e `settlementDate` (CR) o
 * dia em que a operação clicou "baixar", não o dia em que o dinheiro
 * andou. Como a conciliação é feita pela manhã com as movimentações da
 * véspera, uma defasagem de poucos dias entre baixa e vencimento é
 * "baixa preguiçosa" — não é atraso real. Sem essa regra, os gráficos
 * apresentam como atraso o que na verdade é apenas fluxo administrativo.
 *
 * Estados:
 *   • Não realizado (settlementDate == null && !isSettled)   → null
 *   • paymentDate == null (Nomus não preencheu, é liquidado) → dueDate
 *   • paymentDate ≤ dueDate                                  → paymentDate
 *   • dias ÚTEIS(dueDate → paymentDate) ≤ toleranceDays      → dueDate
 *   • dias ÚTEIS(dueDate → paymentDate) > toleranceDays      → paymentDate
 *
 * A tolerância conta DIAS ÚTEIS (seg–sex): fim de semana não é "atraso" de
 * conciliação — vencimento na sexta baixado na segunda é 1 dia útil, não 3.
 * Contar corridos marcava como atraso real qualquer vencimento de fim de
 * semana conciliado no início da semana seguinte. Feriados NÃO são
 * descontados (o sistema não tem calendário de feriados); a folga de 3 úteis
 * absorve o feriado isolado típico.
 *
 * Quando `enabled=false`, o comportamento histórico do AP é preservado
 * (`effectivePaymentDate = dueDate` sempre que baixado) — o mesmo que a
 * função sem opções sempre fez.
 */

export type FinanceSettlementReconciliationPolicy = {
  enabled: boolean;
  /** Tolerância em DIAS ÚTEIS (seg–sex) entre vencimento e baixa. */
  toleranceDays: number;
};

export const FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS: FinanceSettlementReconciliationPolicy = {
  enabled: true,
  toleranceDays: 3,
};

/**
 * Comportamento histórico do AP — antes da regra, o motor CANÔNICO usava
 * `dueDate` para todo CP baixado (Nomus raramente preenche paymentDate
 * confiável). Mantido como fallback quando a política estiver desligada.
 */
export const FINANCE_SETTLEMENT_RECONCILIATION_LEGACY: FinanceSettlementReconciliationPolicy = {
  enabled: false,
  toleranceDays: 0,
};

function toDate(value: Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function diffCalendarDays(later: Date, earlier: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  const l = Date.UTC(
    later.getUTCFullYear(),
    later.getUTCMonth(),
    later.getUTCDate()
  );
  const e = Date.UTC(
    earlier.getUTCFullYear(),
    earlier.getUTCMonth(),
    earlier.getUTCDate()
  );
  return Math.round((l - e) / MS);
}

/**
 * Dias ÚTEIS (seg–sex) no intervalo (earlier, later] — exclusivo no início,
 * inclusivo no fim. Ex.: sexta → segunda = 1; quinta → segunda = 2.
 * Feriados não são descontados (sem calendário de feriados no sistema).
 */
function diffBusinessDays(later: Date, earlier: Date): number {
  const cursor = new Date(
    Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate())
  );
  const end = Date.UTC(
    later.getUTCFullYear(),
    later.getUTCMonth(),
    later.getUTCDate()
  );
  let count = 0;
  while (cursor.getTime() < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

export type FinanceSettlementReconciliationInput = {
  /** Vencimento oficial do título — âncora da regra. */
  dueDate: Date | null | undefined;
  /**
   * Data em que o Nomus registrou a baixa. Semântica igual para AR
   * (`settlementDate`) e AP (`paymentDate`).
   */
  settledOn: Date | null | undefined;
  /** Se o título já foi liquidado (para o fallback histórico do AP). */
  isSettled: boolean;
};

/**
 * Devolve a data efetiva de caixa a aplicar no motor CANÔNICO:
 *   • null → título não realizado (não entra em fluxo realizado)
 *   • Date → dia em que o dinheiro EFETIVAMENTE andou pelo caixa
 */
export function resolveFinanceEffectiveSettlementDate(
  input: FinanceSettlementReconciliationInput,
  policy: FinanceSettlementReconciliationPolicy = FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS
): Date | null {
  const dueDate = toDate(input.dueDate);
  const settledOn = toDate(input.settledOn);

  // Não realizado → sem data efetiva.
  if (!input.isSettled && settledOn == null) return null;

  // Política desligada → comportamento histórico (dueDate quando existe;
  // senão, mantém o settledOn se houver).
  if (!policy.enabled) {
    return dueDate ?? settledOn ?? null;
  }

  // Sem paymentDate/settlementDate (Nomus não preencheu) → dueDate.
  if (settledOn == null) return dueDate;

  // Sem dueDate — não há como comparar; assume o dado que existe.
  if (dueDate == null) return settledOn;

  // Baixa antes ou no dia do vencimento → respeita a baixa (o dinheiro
  // realmente saiu/entrou antes; adiantamento é fato bancário).
  if (diffCalendarDays(settledOn, dueDate) <= 0) return settledOn;

  const tolerance = Math.max(0, Math.floor(policy.toleranceDays));

  // Dentro da tolerância em DIAS ÚTEIS → conciliação preguiçosa,
  // data efetiva = dueDate. Fim de semana no meio não conta.
  if (diffBusinessDays(settledOn, dueDate) <= tolerance) return dueDate;

  // Fora da tolerância → atraso real, mantém a data de baixa.
  return settledOn;
}

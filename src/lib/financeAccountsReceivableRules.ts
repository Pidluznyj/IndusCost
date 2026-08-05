/**
 * Regra canônica de data efetiva de RECEBIMENTO — espelho do que existe
 * para AP em financeAccountsPayableRules.ts.
 *
 * Não existia função dedicada porque historicamente o AR usava
 * `settlementDate` cru como fonte de verdade. Com a regra dos N dias
 * (conciliação preguiçosa da manhã), CR também precisa da mesma
 * distinção: baixa dentro da tolerância vira dueDate; fora, mantém
 * settlementDate como atraso real.
 *
 * Compatibilidade: sem opções, comportamento LEGADO — devolve o
 * settlementDate cru; ativação da política é explícita, feita pelos
 * motores que já passam a policy carregada (motor único-de-dia da Caixa,
 * cenários, etc.).
 */

import {
  FINANCE_SETTLEMENT_RECONCILIATION_LEGACY,
  resolveFinanceEffectiveSettlementDate,
  type FinanceSettlementReconciliationPolicy,
} from "@/src/lib/finance/financeSettlementReconciliation.js";

export type FinanceArEffectiveSettlementInput = {
  dueDate: Date | null | undefined;
  settlementDate: Date | null | undefined;
  amountReceived?: number | null;
  balanceReceivable?: number | null;
};

export type FinanceArEffectiveSettlementOptions = {
  reconciliation?: FinanceSettlementReconciliationPolicy;
};

/**
 * Devolve a data em que o CR EFETIVAMENTE entrou no caixa:
 *   • Sem baixa (`amountReceived <= 0` e sem settlementDate) → null
 *   • Com política ligada → aplica regra dos N dias (mesma canônica do AP)
 *   • Sem política ou desligada → `settlementDate` cru (comportamento legado)
 */
export function resolveFinanceArEffectiveSettlementDate(
  input: FinanceArEffectiveSettlementInput,
  options: FinanceArEffectiveSettlementOptions = {}
): Date | null {
  const received = Number(input.amountReceived ?? 0);
  const hasBaixa = received > 0 || input.settlementDate != null;
  if (!hasBaixa) return null;
  return resolveFinanceEffectiveSettlementDate(
    {
      dueDate: input.dueDate ?? null,
      settledOn: input.settlementDate ?? null,
      isSettled:
        received > 0 || (input.balanceReceivable != null && input.balanceReceivable <= 0),
    },
    options.reconciliation ?? FINANCE_SETTLEMENT_RECONCILIATION_LEGACY
  );
}

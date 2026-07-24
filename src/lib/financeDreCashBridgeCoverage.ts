/**
 * Matriz estática de cobertura da Ponte Lucro × Caixa (v1 parcial).
 */

import type { CashBridgeCoverageRow } from "@/src/lib/financeDreCashBridgeTypes.js";

export const FINANCE_DRE_CASH_BRIDGE_COVERAGE: readonly CashBridgeCoverageRow[] = [
  {
    componentId: "dre_net_result",
    label: "Resultado líquido (DRE)",
    status: "available",
    sourceLabel: "buildFinanceDreReport → kpis.lucroLiquidoAproximado",
    limitation: "DRE aproximada (sem resultado financeiro; IRPJ/CSLL como provisão gerencial estimada).",
  },
  {
    componentId: "non_cash_adjustments",
    label: "Ajustes sem efeito caixa",
    status: "unavailable",
    sourceLabel: "—",
    limitation: "Sem ledger de imobilizado/depreciação/provisões.",
  },
  {
    componentId: "accounts_receivable",
    label: "Contas a receber (saldo as-of)",
    status: "unavailable",
    sourceLabel: "NomusAccountsReceivable.balanceReceivable",
    limitation: "Só estado atual do sync; sem snapshot/histórico as-of no mês.",
  },
  {
    componentId: "inventory",
    label: "Estoques (saldo as-of)",
    status: "unavailable",
    sourceLabel: "InventoryBalance / InventoryMovement",
    limitation: "Sem posição histórica oficial valorada no mês.",
  },
  {
    componentId: "operational_payables",
    label: "Fornecedores operacionais (saldo as-of)",
    status: "unavailable",
    sourceLabel: "NomusAccountsPayable + centros de custo",
    limitation: "Mesmo limite as-of; taxonomia ops/invest/financiamento só heurística.",
  },
  {
    componentId: "investments_paid",
    label: "Investimentos pagos",
    status: "partial",
    sourceLabel: "AP + CC INVESTIMENTO SOCIOS / keywords",
    limitation: "Proxy de classificação; sem evidência de pagamento de ativo vs cadastro.",
  },
  {
    componentId: "financing_and_equity",
    label: "Captações / amortização / distribuição",
    status: "unavailable",
    sourceLabel: "—",
    limitation: "Sem ledger de empréstimo/equity.",
  },
  {
    componentId: "bank_cash",
    label: "Caixa e bancos (variação real)",
    status: "unavailable",
    sourceLabel: "Fluxo de caixa (hasInitialBankBalance: false)",
    limitation: "Sem conta/saldo/snapshot bancário histórico.",
  },
  {
    componentId: "period_cash_movements",
    label: "Movimentos AR/AP do período (anexo)",
    status: "partial",
    sourceLabel: "Dashboards cash-flow / settlementDate",
    limitation: "Referência operacional; fora da fórmula patrimonial da ponte.",
  },
] as const;

export const UNAVAILABLE_BANK_CASH_REASON =
  "IndusCost não possui saldo bancário inicial nem histórico de disponibilidades (hasInitialBankBalance: false).";

export const UNAVAILABLE_AS_OF_BALANCE_REASON =
  "Não há snapshot patrimonial as-of no início/fim do mês; o sync atual não substitui posição histórica.";

export const PERIOD_CASH_MOVEMENTS_ANNEX_NOTE =
  "Recebimentos e pagamentos do período (Fluxo de Caixa) são referência operacional e não representam variação patrimonial de saldos. Não entram em explainedCashVariation.";

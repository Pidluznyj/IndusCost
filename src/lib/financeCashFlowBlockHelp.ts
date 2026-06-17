/**
 * Textos de ajuda (tooltips) dos blocos do Fluxo de Caixa.
 * Mantidos em lib para testes e reuso nos componentes.
 */

export const FINANCE_CF_HELP_OVERDUE_RECEIVABLES =
  "Usa a mesma base da aba Contas a Receber > Atrasados. Exclui títulos stale, recebidos, sem saldo e vencidos sem NF." as const;

export const FINANCE_CF_HELP_OVERDUE_PAYABLES =
  "Usa a mesma regra gerencial de Contas a Pagar. Exclui AP stale, intercompany e pedido de compra. Considera data operacional." as const;

export const FINANCE_CF_HELP_LARGEST_PROJECTED_INFLOWS =
  "Usa Contas a Receber saneado. Títulos futuros sem NF podem aparecer como previsão; títulos vencidos sem NF são excluídos." as const;

export const FINANCE_CF_HELP_LARGEST_PROJECTED_OUTFLOWS =
  "Usa Contas a Pagar saneado por data operacional." as const;

export const FINANCE_CF_HELP_TOP_CUSTOMERS =
  "Ranking por saldo em aberto AR — mesma base das entradas previstas exibidas nesta visão (portfólio filtrado)." as const;

export const FINANCE_CF_HELP_TOP_SUPPLIERS =
  "Ranking por saldo em aberto AP — mesma base das saídas previstas exibidas nesta visão (portfólio filtrado)." as const;

export const FINANCE_CF_HELP_MONTHLY_TIMELINE =
  "Consolida entradas e saídas mensais usando os motores saneados de Contas a Receber e Contas a Pagar." as const;

export const FINANCE_CF_HELP_MONTHLY_TIMELINE_EXCEPTION =
  "Exceção: esta linha do tempo executiva estima inflow/outflow mensal independentemente do modo Previsto/Realizado do filtro global." as const;

export const FINANCE_CF_HELP_MONTHLY_CHART =
  `${FINANCE_CF_HELP_MONTHLY_TIMELINE} ${FINANCE_CF_HELP_MONTHLY_TIMELINE_EXCEPTION}` as const;

export const FINANCE_CF_HELP_CALENDAR =
  "Calendário reconciliado com a linha do tempo do Fluxo. Movimentos diários usam as mesmas regras do ledger (CR/AP saneados)." as const;

export const FINANCE_CF_HELP_RECONCILIATION =
  "Conferência interna: cards do período vs recomputação do ledger e carteira aberta vs Contas a Receber / Contas a Pagar oficiais." as const;

export const FINANCE_CF_HELP_AUDIT_SECTION =
  "Detalhes técnicos de sync, cutoffs Nomus e títulos excluídos pela saneamento gerencial. Não altera os números exibidos." as const;

export const FINANCE_CF_BLOCK_HELP = {
  overdueReceivables: FINANCE_CF_HELP_OVERDUE_RECEIVABLES,
  overduePayables: FINANCE_CF_HELP_OVERDUE_PAYABLES,
  largestProjectedInflows: FINANCE_CF_HELP_LARGEST_PROJECTED_INFLOWS,
  largestProjectedOutflows: FINANCE_CF_HELP_LARGEST_PROJECTED_OUTFLOWS,
  topCustomers: FINANCE_CF_HELP_TOP_CUSTOMERS,
  topSuppliers: FINANCE_CF_HELP_TOP_SUPPLIERS,
  monthlyTimeline: FINANCE_CF_HELP_MONTHLY_TIMELINE,
  monthlyChart: FINANCE_CF_HELP_MONTHLY_CHART,
  calendar: FINANCE_CF_HELP_CALENDAR,
  reconciliation: FINANCE_CF_HELP_RECONCILIATION,
} as const;

export type FinanceCashFlowBlockHelpId = keyof typeof FINANCE_CF_BLOCK_HELP;

export function getFinanceCashFlowBlockHelp(id: FinanceCashFlowBlockHelpId): string {
  return FINANCE_CF_BLOCK_HELP[id];
}

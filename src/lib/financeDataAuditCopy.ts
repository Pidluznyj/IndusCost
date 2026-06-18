/** Textos executivos — drawer/modal “Dados e auditoria” do módulo Financeiro. */

export const FINANCE_EXECUTIVE_FILTER_SCOPE_NOTE =
  "Os números seguem os filtros aplicados." as const;

export const FINANCE_AUDIT_DRAWER_TITLE = "Dados e auditoria" as const;

export const FINANCE_AUDIT_SECTION_SOURCES = "Fonte dos dados" as const;
export const FINANCE_AUDIT_SECTION_SYNC = "Última atualização" as const;
export const FINANCE_AUDIT_SECTION_FILTERS = "Filtros aplicados" as const;
export const FINANCE_AUDIT_SECTION_RULES = "Regras gerenciais aplicadas" as const;
export const FINANCE_AUDIT_SECTION_IGNORED = "Registros desconsiderados" as const;
export const FINANCE_AUDIT_SECTION_RECONCILIATION = "Conciliação" as const;

export const FINANCE_AUDIT_RULES_EXECUTIVE = [
  "Movimentos entre empresas do grupo são desconsiderados.",
  "Títulos antigos fora da última sincronização são ignorados.",
  "Pedidos de compra não entram na visão gerencial do caixa.",
  "Contas a receber vencidas sem NF são excluídas da inadimplência gerencial.",
] as const;

export const FINANCE_AUDIT_SANITIZATION_INTRO =
  "Para evitar distorções, o sistema ignora movimentos internos do grupo, títulos antigos fora da última sincronização e pedidos de compra." as const;

export const FINANCE_CASH_FLOW_EXECUTIVE_SUBTITLE =
  "Entradas e saídas previstas para acompanhar a posição de caixa." as const;

export const FINANCE_AR_EXECUTIVE_SUBTITLE =
  "Carteira de recebíveis, recebimentos e valores em aberto." as const;

export const FINANCE_AP_EXECUTIVE_SUBTITLE =
  "Obrigações com fornecedores e saídas de caixa previstas." as const;

/** Padrões visuais e operacionais compartilhados do módulo Financeiro. */

export const FINANCE_MODULE_CATEGORY = "FINANCEIRO" as const;

export const FINANCE_FILTER_PANEL_TITLE = "Filtros" as const;

export const FINANCE_HEADER_ACTION_REFRESH = "Atualizar" as const;
export const FINANCE_HEADER_ACTION_EXPORT_CSV = "Exportar CSV" as const;
export const FINANCE_HEADER_ACTION_EXPORT_PDF = "Exportar PDF" as const;

export const FINANCE_MODULE_LOADING_DEFAULT = "Carregando dados financeiros…" as const;
export const FINANCE_MODULE_EMPTY_FILTERED_TITLE = "Nenhum dado no filtro" as const;
export const FINANCE_MODULE_EMPTY_FILTERED_DESCRIPTION =
  "Não há registros para os filtros aplicados. Ajuste os filtros ou limpe para ver o período completo." as const;

export type FinanceModuleTabId =
  | "cash-flow"
  | "accounts-receivable"
  | "accounts-payable"
  | "billing"
  | "sales-orders"
  | "cost-centers"
  | "executive-report";

export const FINANCE_MODULE_TAB_LABELS: Record<FinanceModuleTabId, string> = {
  "cash-flow": "Fluxo de Caixa",
  "accounts-receivable": "Contas a Receber",
  "accounts-payable": "Contas a Pagar",
  billing: "Faturamento",
  "sales-orders": "Pedidos de Venda",
  "cost-centers": "Centros de Custo",
  "executive-report": "Relatório Presidencial",
};

export const FINANCE_MODULE_TAB_ENDPOINTS: Record<FinanceModuleTabId, string> = {
  "cash-flow": "/api/finance/cash-flow/dashboard",
  "accounts-receivable": "/api/finance/accounts-receivable/dashboard",
  "accounts-payable": "/api/finance/accounts-payable/dashboard",
  billing: "/api/finance/billing/dashboard",
  "sales-orders": "/api/finance/sales-orders/dashboard",
  "cost-centers": "/api/finance/cost-centers/dashboard",
  "executive-report": "/api/finance/executive-report",
};

/** Breadcrumb padrão: FINANCEIRO · NOME DA ABA */
export function buildFinanceModuleEyebrow(tabId: FinanceModuleTabId): string {
  return `${FINANCE_MODULE_CATEGORY} · ${FINANCE_MODULE_TAB_LABELS[tabId].toUpperCase()}`;
}

export function financeModuleFilterFieldClass(): string {
  return "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";
}

export function financeModuleFilterLabelClass(): string {
  return "text-[10px] font-bold uppercase text-muted-foreground";
}

/**
 * Conceitos e textos UI do CRM Comercial (browser-safe).
 * Separação: Responsável Comercial (carteira) × Vendedor Nomus (auditoria/comissão).
 */

export const CRM_UI_TOOLTIPS = {
  commercialOwner:
    "Pessoa responsável pela gestão do relacionamento e follow-up do cliente.",
  orderSeller:
    "Vendedor informado no Pedido de Venda/Nomus. Usado para auditoria e comissionamento.",
  orderValue:
    "Calculado a partir da fonte oficial de Pedidos de Venda.",
} as const;

export const CRM_SELLER_TAB_SUBTITLE =
  "Visão por responsável comercial da carteira. Não altera vendedor comissionável do pedido.";

export const CRM_OFFICIAL_SOURCE_NOTE =
  "Pedidos são buscados da fonte oficial de Pedidos de Venda. A carteira é agrupada pelo responsável comercial do cliente. O vendedor comissionável continua sendo o vendedor do pedido no Nomus.";

export type CrmSourceInfoLike = {
  eixo?: string;
  pedidosFonte?: string;
  itensFonte?: string;
  propostasUsadas?: boolean;
  comissionamentoAfetado?: boolean;
  vendedorPedidoFonte?: string;
  responsavelCarteira?: string;
  period?: { dateFrom?: string | null; dateTo?: string | null };
  warning?: string | null;
  warnings?: string[] | null;
};

export function formatCrmSourceInfoLine(info: CrmSourceInfoLike | null | undefined): string | null {
  if (!info) return null;
  const parts: string[] = [];
  if (info.pedidosFonte) parts.push(`Pedidos: ${info.pedidosFonte}`);
  if (info.itensFonte) parts.push(`Itens: ${info.itensFonte}`);
  if (info.eixo) parts.push(`Carteira: responsável comercial`);
  if (info.comissionamentoAfetado === false) parts.push("Comissão não afetada");
  if (info.propostasUsadas === false) parts.push("Sem propostas");
  if (info.period?.dateFrom || info.period?.dateTo) {
    parts.push(`Período ${info.period.dateFrom ?? "…"} → ${info.period.dateTo ?? "…"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function collectCrmSourceWarnings(
  info: CrmSourceInfoLike | null | undefined
): string[] {
  if (!info) return [];
  const out: string[] = [];
  if (info.warning?.trim()) out.push(info.warning.trim());
  if (Array.isArray(info.warnings)) {
    for (const w of info.warnings) {
      const t = typeof w === "string" ? w.trim() : "";
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export type CrmPortfolioListEmptyKind =
  | "loading"
  | "error"
  | "not_loaded"
  | "no_customers_for_owner"
  | "no_match_filters"
  | "empty_scope";

export function resolveCrmPortfolioListEmptyKind(args: {
  loading: boolean;
  error: string | null;
  customerCount: number;
  sellerFilterActive: boolean;
  hasOtherFilters: boolean;
  hasSourceInfo?: boolean;
}): CrmPortfolioListEmptyKind | null {
  if (args.loading) return "loading";
  if (args.error) return "error";
  if (args.customerCount > 0) return null;
  if (args.hasSourceInfo === false) return "not_loaded";
  if (args.sellerFilterActive && !args.hasOtherFilters) return "no_customers_for_owner";
  if (args.sellerFilterActive || args.hasOtherFilters) return "no_match_filters";
  return "empty_scope";
}

export function crmPortfolioListEmptyCopy(kind: CrmPortfolioListEmptyKind): {
  title: string;
  body: string;
} {
  switch (kind) {
    case "loading":
      return { title: "Carregando", body: "Buscando clientes…" };
    case "error":
      return {
        title: "Não foi possível carregar",
        body: "Erro ao carregar a carteira. Tente novamente.",
      };
    case "not_loaded":
      return {
        title: "Dados não carregados",
        body: "A carteira ainda não foi carregada. Atualize a lista ou ajuste o escopo.",
      };
    case "no_customers_for_owner":
      return {
        title: "Nenhum cliente sob esta responsabilidade",
        body: "Não há clientes com este responsável comercial atribuído. A carteira CRM usa o responsável do cliente, não o vendedor Nomus do pedido.",
      };
    case "no_match_filters":
      return {
        title: "Nenhum cliente encontrado",
        body: "Nenhum cliente encontrado para este responsável com os filtros aplicados.",
      };
    case "empty_scope":
    default:
      return {
        title: "Carteira vazia neste escopo",
        body: "Ajuste a busca ou os filtros. O escopo do seu usuário também limita os resultados.",
      };
  }
}

/** Clientes listados, mas nenhum com pedido no período da API. */
export const CRM_PORTFOLIO_NO_ORDERS_IN_PERIOD_NOTE =
  "Há clientes nesta carteira, mas nenhum pedido no período da fonte oficial. Valores de período zerados são reais.";

export type CrmSellerEmptyKind =
  | "not_linked"
  | "loading"
  | "error"
  | "no_customers_for_owner"
  | "no_orders_in_period"
  | "ready";

export function resolveCrmSellerEmptyKind(args: {
  sellerNotLinked: boolean;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  emptyStateReason?: string | null;
  totalOrders?: number | null;
  customerCount?: number | null;
}): CrmSellerEmptyKind {
  if (args.sellerNotLinked) return "not_linked";
  if (args.loading) return "loading";
  if (args.error) return "error";
  if (!args.hasData) return "error";
  if (args.emptyStateReason === "NO_CUSTOMERS_FOR_COMMERCIAL_OWNER") {
    return "no_customers_for_owner";
  }
  if ((args.customerCount ?? 0) > 0 && (args.totalOrders ?? 0) === 0) {
    return "no_orders_in_period";
  }
  return "ready";
}

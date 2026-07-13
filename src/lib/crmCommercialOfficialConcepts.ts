/**
 * Conceitos oficiais do CRM Comercial (norma documental).
 * Não altera runtime de APIs/UI — uso futuro em correções alinhadas a
 * docs/commercial/crm-commercial-official-rules.md
 */

/** Eixo de agrupamento da carteira no CRM. */
export const CRM_PORTFOLIO_AXIS = "commercial_owner" as const;

/** Eixo oficial da tela Pedidos de Venda / comissões. */
export const SALES_ORDER_SELLER_AXIS = "nomus_order_seller" as const;

export type CrmPortfolioAxis = typeof CRM_PORTFOLIO_AXIS;
export type SalesOrderSellerAxis = typeof SALES_ORDER_SELLER_AXIS;

/** Mensagens oficiais de UI (PT-BR). */
export const CRM_OFFICIAL_UI_MESSAGES = {
  customerWithoutCommercialOwner: "Cliente sem responsável comercial definido.",
  orderWithoutNomusSeller: "Pedido sem vendedor informado no Nomus.",
  ownerDiffersFromOrderSeller: "Responsável do cliente diferente do vendedor do pedido.",
} as const;

export type CrmOfficialUiMessageKey = keyof typeof CRM_OFFICIAL_UI_MESSAGES;

/** Indicadores de pedido exigidos nas abas de gestão (norma). */
export const CRM_OFFICIAL_ORDER_KPI_KEYS = [
  "ordersIssued",
  "ordersValue",
  "openPortfolioCount",
  "openPortfolioValue",
  "invoicedOrdersCount",
  "invoicedOrdersValue",
  "cancelledOrdersCount",
  "averageTicket",
  "customersWithOrder",
  "topProduct",
  "customersWithoutPurchase",
  "followUps",
] as const;

export type CrmOfficialOrderKpiKey = (typeof CRM_OFFICIAL_ORDER_KPI_KEYS)[number];

/**
 * CRM > Relatórios — relatórios prontos do construtor.
 *
 * Um modelo só PREENCHE o construtor (período, situação, dimensões, métricas,
 * agrupamento, ordenação). Todos rodam no mesmo endpoint e no mesmo núcleo
 * do relatório personalizado — não existem oito motores.
 */

import type {
  CrmCustomReportCustomerStatus,
  CrmCustomReportDimension,
  CrmCustomReportMetric,
  CrmCustomReportSortDirection,
  CrmCustomReportSortKey,
} from "@/src/lib/commercial/crmReportsTypes";
import {
  normalizeCrmReportBuilder,
  type CrmReportBuilderState,
  type CrmReportPeriodPreset,
} from "@/src/lib/commercial/crmReportsUiState";

export type CrmReportTemplate = {
  id: string;
  label: string;
  description: string;
  periodPreset: CrmReportPeriodPreset;
  customerStatus: CrmCustomReportCustomerStatus;
  dimensions: CrmCustomReportDimension[];
  metrics: CrmCustomReportMetric[];
  groupBy: CrmCustomReportDimension | null;
  sort: { by: CrmCustomReportSortKey; direction: CrmCustomReportSortDirection } | null;
};

export const CRM_REPORT_TEMPLATES: readonly CrmReportTemplate[] = [
  {
    id: "sales-by-customer",
    label: "Vendas por Cliente",
    description: "Valor, pedidos e ticket de cada cliente no período.",
    periodPreset: "LAST_12_MONTHS",
    customerStatus: "ALL",
    dimensions: ["customer"],
    metrics: ["soldValue", "orders", "averageTicket", "lastPurchaseDate"],
    groupBy: null,
    sort: { by: "soldValue", direction: "desc" },
  },
  {
    id: "sales-by-owner",
    label: "Vendas por Responsável Comercial",
    description: "Carteira: soma pelo Responsável Comercial do cliente.",
    periodPreset: "LAST_12_MONTHS",
    customerStatus: "ALL",
    dimensions: ["commercialOwner"],
    metrics: ["soldValue", "orders", "customers", "averageTicket"],
    groupBy: null,
    sort: { by: "soldValue", direction: "desc" },
  },
  {
    id: "sales-by-order-seller",
    label: "Vendas por Vendedor do Pedido",
    description: "Auditoria: soma pelo vendedor Nomus de cada pedido.",
    periodPreset: "LAST_12_MONTHS",
    customerStatus: "ALL",
    dimensions: ["orderSeller"],
    metrics: ["soldValue", "orders", "customers", "averageTicket"],
    groupBy: null,
    sort: { by: "soldValue", direction: "desc" },
  },
  {
    id: "owner-x-order-seller",
    label: "Responsável × Vendedor do Pedido",
    description: "Quem é dono da carteira × quem lançou o pedido.",
    periodPreset: "LAST_12_MONTHS",
    customerStatus: "ALL",
    dimensions: ["commercialOwner", "orderSeller"],
    metrics: ["soldValue", "orders", "customers"],
    groupBy: "commercialOwner",
    sort: { by: "soldValue", direction: "desc" },
  },
  {
    id: "customers-without-purchase",
    label: "Clientes sem Compra",
    description: "Clientes do universo sem pedido no período.",
    periodPreset: "LAST_12_MONTHS",
    customerStatus: "WITHOUT_PURCHASE",
    dimensions: ["customer", "commercialOwner"],
    metrics: ["lastPurchaseDate", "daysSinceLastPurchase"],
    groupBy: null,
    sort: { by: "daysSinceLastPurchase", direction: "desc" },
  },
  {
    id: "monthly-by-customer",
    label: "Evolução Mensal por Cliente",
    description: "Venda mês a mês de cada cliente, com subtotal por cliente.",
    periodPreset: "LAST_12_MONTHS",
    customerStatus: "ALL",
    dimensions: ["customer", "month"],
    metrics: ["soldValue", "orders"],
    groupBy: "customer",
    sort: { by: "month", direction: "asc" },
  },
  {
    id: "overdue-repurchase",
    label: "Atrasados para Recompra",
    description: "Situação do motor de recompra: passou da data esperada.",
    periodPreset: "LAST_12_MONTHS",
    customerStatus: "REPURCHASE_OVERDUE",
    dimensions: ["customer", "commercialOwner"],
    metrics: ["overdueDays", "averageRepurchaseDays", "lastPurchaseDate", "soldValue"],
    groupBy: null,
    sort: { by: "overdueDays", direction: "desc" },
  },
  {
    id: "due-soon-repurchase",
    label: "Próximos a Recomprar",
    description: "Recompra esperada entre hoje e os próximos 15 dias.",
    periodPreset: "LAST_12_MONTHS",
    customerStatus: "REPURCHASE_DUE_SOON",
    dimensions: ["customer", "commercialOwner"],
    metrics: ["overdueDays", "averageRepurchaseDays", "lastPurchaseDate", "soldValue"],
    groupBy: null,
    sort: { by: "overdueDays", direction: "desc" },
  },
];

/** Aplica o modelo: substitui o construtor inteiro (mantém datas personalizadas digitadas). */
export function applyCrmReportTemplate(
  current: CrmReportBuilderState,
  template: CrmReportTemplate
): CrmReportBuilderState {
  return normalizeCrmReportBuilder({
    ...current,
    templateId: template.id,
    periodPreset: template.periodPreset,
    customerStatus: template.customerStatus,
    dimensions: [...template.dimensions],
    metrics: [...template.metrics],
    groupBy: template.groupBy,
    sortBy: template.sort?.by ?? null,
    sortDirection: template.sort?.direction ?? "desc",
  });
}

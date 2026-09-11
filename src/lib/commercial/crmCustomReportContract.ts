/**
 * Relatório personalizado de CRM > Relatórios — regras de CONTRATO puras.
 *
 * Fonte única da disponibilidade de métricas por granularidade: o parser do
 * backend (crmCustomReportCore) recusa combinações inseguras com este motivo,
 * e o construtor da UI desabilita as mesmas opções com o mesmo texto. Sem
 * agregação e sem regra de compra aqui.
 */

import {
  CRM_CUSTOM_REPORT_METRIC_AVAILABILITY,
  CRM_CUSTOM_REPORT_ORDER_DIMENSIONS,
  type CrmCustomReportDimension,
  type CrmCustomReportMetric,
} from "@/src/lib/commercial/crmReportsTypes.js";

export function isCrmCustomReportOrderDimension(dimension: CrmCustomReportDimension): boolean {
  return CRM_CUSTOM_REPORT_ORDER_DIMENSIONS.includes(dimension);
}

/** Métrica disponível para as dimensões escolhidas? (e o motivo, se não). */
export function describeCrmCustomReportMetricAvailability(
  metric: CrmCustomReportMetric,
  dimensions: readonly CrmCustomReportDimension[]
): { available: boolean; reason: string | null } {
  const availability = CRM_CUSTOM_REPORT_METRIC_AVAILABILITY[metric];
  const hasOrderDimension = dimensions.some(isCrmCustomReportOrderDimension);
  if (availability === "ALWAYS") return { available: true, reason: null };
  if (availability === "NO_ORDER_DIM") {
    return hasOrderDimension
      ? {
          available: false,
          reason:
            "Recência do cliente não combina com Vendedor do pedido, Mês ou Ano (a linha deixa de ser o cliente).",
        }
      : { available: true, reason: null };
  }
  const customerGrain = dimensions.includes("customer") && !hasOrderDimension;
  return customerGrain
    ? { available: true, reason: null }
    : {
        available: false,
        reason:
          "Cadência é do cliente: exige a dimensão Cliente e nenhuma de Vendedor do pedido, Mês ou Ano.",
      };
}

/** "Sem compra no período" só faz sentido sem dimensão de pedido (não há pedido para agrupar). */
export const CRM_CUSTOM_REPORT_WITHOUT_PURCHASE_ORDER_DIM_REASON =
  "\"Sem compra no período\" não combina com Vendedor do pedido, Mês ou Ano (não há pedido para agrupar).";

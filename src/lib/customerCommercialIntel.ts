/**
 * @deprecated Import from customerCommercialShared ou customerCommercialSalesOrderView.
 * Reexporta utilitários compartilhados e inteligência legada baseada em Proposta.
 *
 * Regra comercial: Pedido de Venda = fonte principal; Proposta = pré-venda.
 * Não use computeCommercialPhase2 como proxy de receita/pipeline.
 */

export * from "@/src/lib/customerCommercialShared";
export * from "@/src/lib/customerCommercialProposalLegacy";

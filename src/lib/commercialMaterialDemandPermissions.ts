/**
 * Permissões do relatório de demanda de matéria-prima.
 *
 * Histórico: `proposals.material_report.view` foi criada quando o relatório vivia no módulo Propostas.
 * O relatório agora é baseado em Pedidos de Venda; a permissão canônica é `reports.material_demand.view`.
 * A permissão legada continua aceita nos guards de API por compatibilidade com perfis existentes.
 */

/** @deprecated Nomenclatura legada — preferir reports.material_demand.view em novos perfis. */
export const LEGACY_MATERIAL_DEMAND_PERMISSION = "proposals.material_report.view";

/** Permissão canônica para relatório consolidado de demanda de MP. */
export const MATERIAL_DEMAND_VIEW_PERMISSION = "reports.material_demand.view";

/** Qualquer uma destas permissões libera rotas GET material-demand (products e sales-orders). */
export const MATERIAL_DEMAND_VIEW_PERMISSIONS = [
  MATERIAL_DEMAND_VIEW_PERMISSION,
  LEGACY_MATERIAL_DEMAND_PERMISSION,
  "products.view",
  "sales_orders.view",
] as const;

export type MaterialDemandPermissionChecker = {
  hasPermission: (permission: string) => boolean;
};

export function canViewMaterialDemand(check: MaterialDemandPermissionChecker): boolean {
  return MATERIAL_DEMAND_VIEW_PERMISSIONS.some((p) => check.hasPermission(p));
}

export function materialDemandPermissionDeniedMessage(): string {
  return "Sem permissão para consultar demanda de matéria-prima.";
}

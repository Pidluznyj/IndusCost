/**
 * Segregação adicional do Detalhe do Pedido de Venda por persona.
 *
 * Não substitui resource permissions nem a regra própria da aba Tributos
 * (`canViewSalesOrderFiscalTaxes`). O deny do role SELLER vence grants
 * genéricos só para Custos, Resultado detalhado e Auditoria 360º.
 *
 * COMMERCIAL_MANAGER, ADMIN, SUPER_ADMIN, VIEWER e perfis customizados
 * não são afetados por esta regra.
 */

export type SalesOrderDetailAccessInput = {
  role?: string | null;
};

export type SalesOrderDetailAccess = {
  canViewGeneral: true;
  canViewCosts: boolean;
  canViewDetailedResult: boolean;
  canOpenAudit360: boolean;
};

export function isSalesOrderSellerPersona(
  role: string | null | undefined
): boolean {
  return (role ?? "").trim().toUpperCase() === "SELLER";
}

export function resolveSalesOrderDetailAccess(
  auth: SalesOrderDetailAccessInput | null | undefined
): SalesOrderDetailAccess {
  const seller = isSalesOrderSellerPersona(auth?.role);
  return {
    canViewGeneral: true,
    canViewCosts: !seller,
    canViewDetailedResult: !seller,
    canOpenAudit360: !seller,
  };
}

/** Custos e Resultado compartilham o mesmo bloco industrial. */
export function shouldLoadSalesOrderIndustrialResult(
  access: SalesOrderDetailAccess
): boolean {
  return access.canViewCosts || access.canViewDetailedResult;
}

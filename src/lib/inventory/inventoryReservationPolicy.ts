/**
 * Política explícita de reserva vs disponível (OP-11).
 *
 * Regra padrão: reserva NÃO pode exceder saldo disponível
 * (available = physical − reserved − blocked − quarantine).
 *
 * Exceção documentada: somente com `allowOverReservation: true` no contexto
 * de movimentação, o que exige permissão `inventory.movements.override`.
 *
 * Nesta fase NÃO há integração automática com ordem de produção ou pedido de venda.
 * Tipos SALES_ORDER / PRODUCTION_ORDER são apenas classificação manual/soft-ref.
 */
export const INVENTORY_OVER_RESERVATION_POLICY = {
  defaultAllowOverReservation: false,
  overridePermissionKey: "inventory.movements.override",
  integrationsAutoReserveFromSalesOrder: false,
  integrationsAutoReserveFromProductionOrder: false,
} as const;

export function resolveAllowOverReservation(input: {
  allowOverReservation?: boolean;
  permissions?: readonly string[];
}): boolean {
  if (input.allowOverReservation !== true) return false;
  const perms = input.permissions ?? [];
  return (
    perms.includes(INVENTORY_OVER_RESERVATION_POLICY.overridePermissionKey) ||
    perms.includes("inventory.manage")
  );
}

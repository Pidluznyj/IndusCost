/** Permissões do módulo Estoque / Almoxarifado. */

export const INVENTORY_VIEW_PERMISSIONS = ["inventory.view"] as const;

export const INVENTORY_MANAGE_PERMISSIONS = ["inventory.manage"] as const;

export const INVENTORY_MOVEMENT_CREATE_PERMISSIONS = [
  "inventory.movements.create",
] as const;

export const INVENTORY_RESERVATIONS_MANAGE_PERMISSIONS = [
  "inventory.reservations.manage",
] as const;

export const INVENTORY_COUNT_MANAGE_PERMISSIONS = [
  "inventory.count.manage",
  "inventory.manage",
] as const;

/** Criar movimentação ou reserva manual. */
export const INVENTORY_MOVEMENT_OR_RESERVATION_PERMISSIONS = [
  ...INVENTORY_MOVEMENT_CREATE_PERMISSIONS,
  ...INVENTORY_RESERVATIONS_MANAGE_PERMISSIONS,
] as const;
